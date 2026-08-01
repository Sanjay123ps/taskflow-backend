import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { supabaseAdmin } from '../../config/supabase';
import { toAdminRequestDTO } from '../../utils/dto';
import { buildPaginatedResult, normalizePagination } from '../../utils/pagination';
import { ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors';
import { logActivity } from '../activities/activity.service';
import { createNotification } from '../notifications/notifications.service';
import type { AdminRequestQueryInput, SubmitAdminRequestInput } from './adminRequest.validation';

const MAX_ACTIVE_ADMINS = 2;
const requestInclude = { requestedBy: true, reviewedBy: true } as const;

export async function submitAdminRequest(input: SubmitAdminRequestInput, requestedByProfileId: string) {
  const activeAdminCount = await prisma.profile.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
  if (activeAdminCount >= MAX_ACTIVE_ADMINS) {
    throw new ConflictError(`The maximum of ${MAX_ACTIVE_ADMINS} active admin accounts has been reached.`);
  }

  const existingProfile = await prisma.profile.findUnique({ where: { email: input.email } });
  if (existingProfile) {
    throw new ConflictError('A user with this email already exists.');
  }

  const existingPending = await prisma.adminCreationRequest.findFirst({
    where: { email: input.email, status: 'PENDING' },
  });
  if (existingPending) {
    throw new ConflictError('An admin creation request for this email is already pending.');
  }

  const request = await prisma.adminCreationRequest.create({
    data: {
      requestedById: requestedByProfileId,
      fullName: input.fullName,
      email: input.email,
      status: 'PENDING',
    },
    include: requestInclude,
  });

  await logActivity({
    userId: requestedByProfileId,
    action: 'ADMIN_REQUEST_SUBMITTED',
    description: `Requested a new admin account for ${input.fullName} (${input.email})`,
    entityType: 'AdminCreationRequest',
    entityId: request.id,
  });

  // Notify every *other* active admin — the requester cannot approve their
  // own request, so they don't need a "review this" notification.
  const otherAdmins = await prisma.profile.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE', id: { not: requestedByProfileId } },
  });
  await Promise.all(
    otherAdmins.map((admin) =>
      createNotification({
        userId: admin.id,
        type: 'ADMIN_REQUEST',
        title: 'New admin account request',
        message: `A request to create an admin account for ${input.fullName} needs your review.`,
        entityType: 'AdminCreationRequest',
        entityId: request.id,
      }),
    ),
  );

  return toAdminRequestDTO(request);
}

export async function listAdminRequests(params: AdminRequestQueryInput) {
  const pagination = normalizePagination(params);
  const where: Prisma.AdminCreationRequestWhereInput =
    params.status && params.status !== 'ALL' ? { status: params.status } : {};

  const [rows, total] = await Promise.all([
    prisma.adminCreationRequest.findMany({
      where,
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.adminCreationRequest.count({ where }),
  ]);

  return buildPaginatedResult(rows.map(toAdminRequestDTO), total, pagination);
}

export async function approveAdminRequest(id: string, reviewedByProfileId: string) {
  const request = await prisma.adminCreationRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new NotFoundError('Admin request not found');
  if (request.status !== 'PENDING') {
    throw new ConflictError('This request has already been reviewed.');
  }
  if (request.requestedById === reviewedByProfileId) {
    throw new ForbiddenError('You cannot approve an admin request you submitted yourself.');
  }

  // Re-check the cap at approval time, inside the same logical step as the
  // insert — two admins approving two different requests near-simultaneously
  // must not both succeed and push the count past 2.
  const result = await prisma.$transaction(async (tx) => {
    const activeAdminCount = await tx.profile.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
    if (activeAdminCount >= MAX_ACTIVE_ADMINS) {
      throw new ConflictError(`The maximum of ${MAX_ACTIVE_ADMINS} active admin accounts has been reached.`);
    }

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(request.email);
    if (error || !data.user) {
      throw new ConflictError(error?.message ?? 'Could not create the admin auth account.');
    }

    await tx.profile.create({
      data: {
        authUserId: data.user.id,
        fullName: request.fullName,
        email: request.email,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    const updated = await tx.adminCreationRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewedByProfileId, reviewedAt: new Date() },
      include: requestInclude,
    });

    await logActivity(
      {
        userId: reviewedByProfileId,
        action: 'ADMIN_REQUEST_APPROVED',
        description: `Approved admin request for ${request.fullName}`,
        entityType: 'AdminCreationRequest',
        entityId: id,
      },
      tx,
    );

    return updated;
  });

  return toAdminRequestDTO(result);
}

export async function rejectAdminRequest(id: string, reviewedByProfileId: string, reason: string | undefined) {
  const request = await prisma.adminCreationRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new NotFoundError('Admin request not found');
  if (request.status !== 'PENDING') {
    throw new ConflictError('This request has already been reviewed.');
  }
  if (request.requestedById === reviewedByProfileId) {
    throw new ForbiddenError('You cannot reject an admin request you submitted yourself.');
  }

  const updated = await prisma.adminCreationRequest.update({
    where: { id },
    data: { status: 'REJECTED', reviewedById: reviewedByProfileId, reviewedAt: new Date(), rejectionReason: reason },
    include: requestInclude,
  });

  await logActivity({
    userId: reviewedByProfileId,
    action: 'ADMIN_REQUEST_REJECTED',
    description: `Rejected admin request for ${request.fullName}${reason ? `: ${reason}` : ''}`,
    entityType: 'AdminCreationRequest',
    entityId: id,
  });

  return toAdminRequestDTO(updated);
}
