import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { supabaseAdmin } from '../../config/supabase';
import { toAdminSignupRequestDTO } from '../../utils/dto';
import { buildPaginatedResult, normalizePagination } from '../../utils/pagination';
import { ConflictError, NotFoundError } from '../../utils/errors';
import { logActivity } from '../activities/activity.service';
import { createNotification } from '../notifications/notifications.service';
import * as otpService from '../otp/otp.service';
import { verifyCaptcha } from '../../utils/captcha';
import type { AdminSignupQueryInput, SubmitAdminSignupInput } from './adminSignup.validation';

// Same cap as the peer-requested path (adminRequest.service.ts) — re-checked
// again at approval time so two near-simultaneous approvals can't both push
// the count past it.
const MAX_ACTIVE_ADMINS = 2;
const requestInclude = { reviewedBy: true, profile: true } as const;

/**
 * Starts a public admin signup. Creates the Supabase Auth user + a PENDING
 * profile right away (same as staff self-signup — Supabase owns the
 * password from the start, we never see or store it), then emails a 4-digit
 * OTP. Existing admins are *not* notified yet — see verifyAdminSignupOtp.
 */
export async function submitAdminSignup(input: SubmitAdminSignupInput) {
  // Admin signup is a more sensitive path than staff signup and was missing
  // this check entirely — mirror signup.service.ts's staff flow.
  await verifyCaptcha(input.captchaToken);

  const existingProfile = await prisma.profile.findUnique({ where: { email: input.email } });
  if (existingProfile) {
    throw new ConflictError('An account with this email already exists.');
  }

  const existingPendingRequest = await prisma.adminSignupRequest.findFirst({
    where: { email: input.email, status: 'PENDING' },
  });
  if (existingPendingRequest) {
    throw new ConflictError('A signup request for this email is already pending review.');
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new ConflictError(error?.message ?? 'Could not create the account. Please try again.');
  }

  const request = await prisma.$transaction(async (tx) => {
    const profile = await tx.profile.create({
      data: {
        authUserId: data.user.id,
        fullName: input.fullName,
        email: input.email,
        role: 'ADMIN',
        status: 'PENDING',
      },
    });

    return tx.adminSignupRequest.create({
      data: {
        profileId: profile.id,
        fullName: input.fullName,
        email: input.email,
        status: 'PENDING',
      },
      include: requestInclude,
    });
  });

  const otp = await otpService.issueOtp(input.email, 'ADMIN_SIGNUP_VERIFY');

  return { request: toAdminSignupRequestDTO(request), otp };
}

/** Re-sends the signup OTP. No-ops (without leaking why) if there's no matching unverified request. */
export async function resendAdminSignupOtp(email: string): Promise<void> {
  const request = await prisma.adminSignupRequest.findFirst({
    where: { email, status: 'PENDING', emailVerifiedAt: null },
  });
  if (request) {
    await otpService.issueOtp(email, 'ADMIN_SIGNUP_VERIFY');
  }
}

/**
 * Confirms the applicant controls the inbox. This does NOT grant access —
 * the profile stays PENDING. It only makes the request visible/notified to
 * existing admins, who still have to approve it.
 */
export async function verifyAdminSignupOtp(email: string, code: string): Promise<void> {
  await otpService.verifyOtp(email, 'ADMIN_SIGNUP_VERIFY', code);

  const request = await prisma.adminSignupRequest.findFirst({ where: { email, status: 'PENDING' } });
  if (!request || !request.profileId) {
    throw new NotFoundError('Signup request not found');
  }

  await prisma.adminSignupRequest.update({
    where: { id: request.id },
    data: { emailVerifiedAt: new Date() },
  });

  await logActivity({
    userId: request.profileId,
    action: 'ADMIN_REQUEST_SUBMITTED',
    description: `${request.fullName} (${request.email}) verified their email and is awaiting admin approval`,
    entityType: 'AdminSignupRequest',
    entityId: request.id,
  });

  const admins = await prisma.profile.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' } });
  await Promise.all(
    admins.map((admin) =>
      createNotification({
        userId: admin.id,
        type: 'ADMIN_SIGNUP_REQUEST',
        title: 'New admin signup awaiting approval',
        message: `${request.fullName} (${request.email}) verified their email and is awaiting your review.`,
        entityType: 'AdminSignupRequest',
        entityId: request.id,
      }),
    ),
  );
}

export async function listAdminSignupRequests(params: AdminSignupQueryInput) {
  const pagination = normalizePagination(params);
  const where: Prisma.AdminSignupRequestWhereInput =
    params.status && params.status !== 'ALL' ? { status: params.status } : {};

  const [rows, total] = await Promise.all([
    prisma.adminSignupRequest.findMany({
      where,
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.adminSignupRequest.count({ where }),
  ]);

  return buildPaginatedResult(rows.map(toAdminSignupRequestDTO), total, pagination);
}

export async function getAdminSignupRequest(id: string) {
  const request = await prisma.adminSignupRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new NotFoundError('Signup request not found');
  return toAdminSignupRequestDTO(request);
}

export async function approveAdminSignupRequest(id: string, reviewedByProfileId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.adminSignupRequest.findUnique({ where: { id }, include: requestInclude });
    if (!request) throw new NotFoundError('Signup request not found');
    if (request.status !== 'PENDING') {
      throw new ConflictError('This request has already been reviewed.');
    }
    if (!request.emailVerifiedAt) {
      throw new ConflictError("This applicant hasn't verified their email yet.");
    }
    if (!request.profileId) {
      throw new ConflictError('This request has no associated account to approve.');
    }

    const activeAdminCount = await tx.profile.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
    if (activeAdminCount >= MAX_ACTIVE_ADMINS) {
      throw new ConflictError(`The maximum of ${MAX_ACTIVE_ADMINS} active admin accounts has been reached.`);
    }

    await tx.profile.update({ where: { id: request.profileId }, data: { status: 'ACTIVE' } });

    const updated = await tx.adminSignupRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewedByProfileId, reviewedAt: new Date() },
      include: requestInclude,
    });

    await logActivity(
      {
        userId: reviewedByProfileId,
        action: 'ADMIN_REQUEST_APPROVED',
        description: `Approved admin signup for ${request.fullName} (${request.email})`,
        entityType: 'AdminSignupRequest',
        entityId: id,
      },
      tx,
    );

    return updated;
  });

  if (result.profileId) {
    await createNotification({
      userId: result.profileId,
      type: 'ADMIN_SIGNUP_APPROVED',
      title: 'Your admin account has been approved',
      message: 'You can now sign in to TaskFlow.',
      entityType: 'AdminSignupRequest',
      entityId: id,
    });
  }

  return toAdminSignupRequestDTO(result);
}

export async function rejectAdminSignupRequest(id: string, reviewedByProfileId: string, reason: string | undefined) {
  const request = await prisma.adminSignupRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new NotFoundError('Signup request not found');
  if (request.status !== 'PENDING') {
    throw new ConflictError('This request has already been reviewed.');
  }

  const updated = await prisma.adminSignupRequest.update({
    where: { id },
    data: { status: 'REJECTED', reviewedById: reviewedByProfileId, reviewedAt: new Date(), rejectionReason: reason },
    include: requestInclude,
  });

  // Clean up the never-activated auth user + profile rather than leaving a
  // permanently PENDING account around — mirrors signup.service.ts's
  // rejectSignupRequest. The request row itself survives (profileId set
  // null via onDelete: SetNull) so the audit trail is preserved.
  if (request.profile) {
    await prisma.profile.delete({ where: { id: request.profile.id } }).catch(() => undefined);
    await supabaseAdmin.auth.admin.deleteUser(request.profile.authUserId).catch(() => undefined);
  }

  await logActivity({
    userId: reviewedByProfileId,
    action: 'ADMIN_REQUEST_REJECTED',
    description: `Rejected admin signup for ${request.fullName}${reason ? `: ${reason}` : ''}`,
    entityType: 'AdminSignupRequest',
    entityId: id,
  });

  return toAdminSignupRequestDTO(updated);
}
