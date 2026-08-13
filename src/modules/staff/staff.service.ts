import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { supabaseAdmin } from '../../config/supabase';
import { toStaffMemberDTO } from '../../utils/dto';
import { normalizePagination, buildPaginatedResult } from '../../utils/pagination';
import { ConflictError, NotFoundError } from '../../utils/errors';
import { nextEmployeeId } from '../../utils/employeeId';
import { logActivity } from '../activities/activity.service';
import { computeTaskStatsForStaff, computeTaskStatsForStaffIds } from '../tasks/task-stats.util';
import type { CreateStaffInput, StaffQueryInput, UpdateStaffInput } from './staff.validation';

export async function listStaff(params: StaffQueryInput) {
  const pagination = normalizePagination(params);

  const where: Prisma.ProfileWhereInput = {
    role: 'STAFF',
    ...(params.status && params.status !== 'ALL'
      ? { status: params.status }
      : { status: { not: 'PENDING' } }),
    ...(params.department ? { department: params.department } : {}),
    ...(params.search
      ? {
          OR: [
            { fullName: { contains: params.search, mode: 'insensitive' } },
            { email: { contains: params.search, mode: 'insensitive' } },
            { employeeId: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.profile.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.take }),
    prisma.profile.count({ where }),
  ]);

  const statsMap = await computeTaskStatsForStaffIds(rows.map((r) => r.id));
  const items = rows.map((row) => toStaffMemberDTO(row, statsMap.get(row.id)));

  return buildPaginatedResult(items, total, pagination);
}

export async function getStaffMember(id: string) {
  const profile = await prisma.profile.findFirst({ where: { id, role: 'STAFF' } });
  if (!profile) throw new NotFoundError('Staff member not found');
  const stats = await computeTaskStatsForStaff(id);
  return toStaffMemberDTO(profile, stats);
}

/**
 * Admin-initiated staff creation (as opposed to the self-service signup +
 * approval flow). No password is collected — Supabase Auth sends the new
 * staff member an invite email to set their own password.
 */
export async function createStaff(input: CreateStaffInput, createdByProfileId: string) {
  const existing = await prisma.profile.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError('A user with this email already exists.');
  }

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(input.email);
  if (error || !data.user) {
    throw new ConflictError(error?.message ?? 'Could not create the staff auth account.');
  }

  const profile = await prisma.$transaction(async (tx) => {
    const employeeId = await nextEmployeeId(tx);
    return tx.profile.create({
      data: {
        authUserId: data.user.id,
        fullName: input.name,
        email: input.email,
        employeeId,
        phone: input.phone,
        department: input.department,
        designation: input.designation,
        profileImageUrl: input.profileImage ?? null,
        role: 'STAFF',
        status: 'ACTIVE',
        joiningDate: new Date(input.joiningDate),
      },
    });
  });

  await logActivity({
    userId: createdByProfileId,
    action: 'STAFF_CREATED',
    description: `Created staff account for ${profile.fullName} (${profile.employeeId})`,
    entityType: 'Profile',
    entityId: profile.id,
  });

  return toStaffMemberDTO(profile);
}

export async function updateStaff(id: string, input: UpdateStaffInput, updatedByProfileId: string) {
  const existing = await prisma.profile.findFirst({ where: { id, role: 'STAFF' } });
  if (!existing) throw new NotFoundError('Staff member not found');

  const emailChanged = input.email !== undefined && input.email !== existing.email;

  if (emailChanged) {
    const conflict = await prisma.profile.findUnique({ where: { email: input.email } });
    if (conflict && conflict.id !== id) {
      throw new ConflictError('A user with this email already exists.');
    }

    // Sync to Supabase Auth *before* writing the Profile row — Auth is the
    // source of truth for login, so if this fails we must not let the
    // Profile's email drift out of sync with what the user actually signs
    // in with.
    const { error } = await supabaseAdmin.auth.admin.updateUserById(existing.authUserId, {
      email: input.email,
    });
    if (error) {
      throw new ConflictError(error.message || 'Could not update the login email for this account.');
    }
  }

  const profile = await prisma.profile.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { fullName: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.department !== undefined ? { department: input.department } : {}),
      ...(input.designation !== undefined ? { designation: input.designation } : {}),
      ...(input.joiningDate !== undefined ? { joiningDate: new Date(input.joiningDate) } : {}),
      ...(input.profileImage !== undefined ? { profileImageUrl: input.profileImage } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  const action = input.status === 'INACTIVE' ? 'STAFF_DEACTIVATED' : input.status === 'ACTIVE' ? 'STAFF_REACTIVATED' : 'STAFF_UPDATED';

  await logActivity({
    userId: updatedByProfileId,
    action,
    description: `Updated staff profile for ${profile.fullName}`,
    entityType: 'Profile',
    entityId: profile.id,
  });

  // Deactivating an account should also kill any live sessions immediately.
  if (input.status === 'INACTIVE') {
    await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  const stats = await computeTaskStatsForStaff(id);
  return toStaffMemberDTO(profile, stats);
}

export async function resetStaffPassword(id: string, resetByProfileId: string) {
  const profile = await prisma.profile.findFirst({ where: { id, role: 'STAFF' } });
  if (!profile) throw new NotFoundError('Staff member not found');

  const temporaryPassword = crypto.randomBytes(9).toString('base64url'); // 12-char, URL-safe

  const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.authUserId, {
    password: temporaryPassword,
  });
  if (error) {
    throw new ConflictError('Could not reset password. Please try again.');
  }

  await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });

  await logActivity({
    userId: resetByProfileId,
    action: 'PASSWORD_RESET',
    description: `Reset password for ${profile.fullName}`,
    entityType: 'Profile',
    entityId: profile.id,
  });

  return { temporaryPassword };
}
