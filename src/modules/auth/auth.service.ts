import type { Profile } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { supabaseAdmin, supabaseAnon } from '../../config/supabase';
import { env } from '../../config/env';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
  signAccessToken,
} from '../../utils/tokens';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../../utils/errors';
import { logActivity } from '../activities/activity.service';
import { recordLogin, recordLogout } from '../attendance/attendance.service';
import { toAdminProfileDTO, toStaffMemberDTO } from '../../utils/dto';
import * as otpService from '../otp/otp.service';
import type {
  ForgotPasswordInput,
  ResendResetOtpInput,
  ResetPasswordInput,
  VerifyResetOtpInput,
} from './auth.validation';

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function issueSession(profile: Profile, meta: RequestMeta) {
  const accessToken = signAccessToken({ sub: profile.id, authUserId: profile.authUserId, role: profile.role });
  const { token: refreshToken, hash } = generateRefreshToken();

  await prisma.session.create({
    data: {
      userId: profile.id,
      refreshTokenHash: hash,
      ipAddress: meta.ipAddress ?? undefined,
      userAgent: meta.userAgent ?? undefined,
      expiresAt: refreshTokenExpiryDate(),
    },
  });

  return { accessToken, refreshToken };
}

function profileDTOForRole(profile: Profile) {
  return profile.role === 'ADMIN'
    ? { admin: toAdminProfileDTO(profile) }
    : { staff: toStaffMemberDTO(profile) };
}

export async function login(email: string, password: string, meta: RequestMeta) {
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    throw new UnauthorizedError('Invalid email or password.');
  }

  const profile = await prisma.profile.findUnique({ where: { authUserId: data.user.id } });

  if (!profile) {
    throw new UnauthorizedError('Invalid email or password.');
  }

  if (profile.role === 'STAFF' && !profile.emailVerifiedAt) {
    throw new ForbiddenError('Please verify your email address before signing in.');
  }
  if (profile.status === 'PENDING') {
    throw new ForbiddenError('Your account is awaiting admin approval.');
  }
  if (profile.status !== 'ACTIVE') {
    throw new ForbiddenError('Your account is not active. Contact an administrator.');
  }

  const { accessToken, refreshToken } = await issueSession(profile, meta);

  await logActivity({
    userId: profile.id,
    action: profile.role === 'ADMIN' ? 'ADMIN_LOGIN' : 'STAFF_LOGIN',
    description: `${profile.fullName} signed in`,
    entityType: 'Profile',
    entityId: profile.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  if (profile.role === 'STAFF') {
    await recordLogin(profile.id);
    // Signing in always means the staff member is available again — this
    // is the only place presence auto-flips to ACTIVE; a stale BUSY/ACTIVE
    // from a crashed session is corrected the same way on next login.
    await prisma.profile.update({
      where: { id: profile.id },
      data: { presenceStatus: 'ACTIVE', lastActiveAt: new Date() },
    });
  }

  return { accessToken, refreshToken, ...profileDTOForRole(profile) };
}

export async function refresh(rawRefreshToken: string | undefined, meta: RequestMeta) {
  if (!rawRefreshToken) {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }

  const hash = hashRefreshToken(rawRefreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: true } });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }

  if (session.user.status !== 'ACTIVE') {
    throw new UnauthorizedError('Your account is not active.');
  }

  // Rotate: revoke the old refresh token and issue a brand new one, so a
  // stolen-but-already-used token can't be replayed.
  const { token: newRefreshToken, hash: newHash } = generateRefreshToken();
  await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: newHash,
      lastActiveAt: new Date(),
      expiresAt: refreshTokenExpiryDate(),
      ipAddress: meta.ipAddress ?? session.ipAddress,
      userAgent: meta.userAgent ?? session.userAgent,
    },
  });

  const accessToken = signAccessToken({
    sub: session.user.id,
    authUserId: session.user.authUserId,
    role: session.user.role,
  });

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(rawRefreshToken: string | undefined) {
  if (!rawRefreshToken) return;
  const hash = hashRefreshToken(rawRefreshToken);

  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: true } });
  if (!session || session.revokedAt) return;

  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

  const profile = session.user;

  if (profile.role === 'STAFF') {
    await recordLogout(profile.id);
    // Presence is never left dangling as ACTIVE/BUSY once the staff
    // member has actually signed out — Admin -> Staff Management must
    // never show a logged-out account as available.
    await prisma.profile.update({
      where: { id: profile.id },
      data: { presenceStatus: 'OFFLINE', lastActiveAt: new Date() },
    });
  }

  await logActivity({
    userId: profile.id,
    action: profile.role === 'ADMIN' ? 'ADMIN_LOGOUT' : 'STAFF_LOGOUT',
    description: `${profile.fullName} signed out`,
    entityType: 'Profile',
    entityId: profile.id,
  });
}

export async function changePassword(
  profileId: string,
  currentPassword: string,
  newPassword: string,
) {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } });

  const { error } = await supabaseAnon.auth.signInWithPassword({
    email: profile.email,
    password: currentPassword,
  });
  if (error) {
    throw new UnauthorizedError('Current password is incorrect.');
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.authUserId, {
    password: newPassword,
  });
  if (updateError) {
    throw new UnauthorizedError('Could not update password. Please try again.');
  }

  // Password change invalidates every other active session for safety.
  await prisma.session.updateMany({
    where: { userId: profile.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await logActivity({
    userId: profile.id,
    action: 'PASSWORD_CHANGED',
    description: `${profile.fullName} changed their password`,
    entityType: 'Profile',
    entityId: profile.id,
  });
}

export async function getMe(profileId: string) {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } });
  return profile.role === 'ADMIN' ? toAdminProfileDTO(profile) : toStaffMemberDTO(profile);
}

/**
 * One-time bootstrap: creates the very first Admin account. Only works
 * while zero admin profiles exist, and requires the operator-held
 * INITIAL_ADMIN_SETUP_TOKEN (set as a Render env var, never committed).
 */
export async function setupInitialAdmin(input: {
  setupToken: string;
  fullName: string;
  email: string;
  password: string;
}) {
  if (!env.INITIAL_ADMIN_SETUP_TOKEN || input.setupToken !== env.INITIAL_ADMIN_SETUP_TOKEN) {
    throw new ForbiddenError('Invalid setup token.');
  }

  const existingAdminCount = await prisma.profile.count({ where: { role: 'ADMIN' } });
  if (existingAdminCount > 0) {
    throw new ConflictError('An admin account already exists. Initial setup can only run once.');
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new ConflictError(error?.message ?? 'Could not create the admin auth account.');
  }

  const profile = await prisma.profile.create({
    data: {
      authUserId: data.user.id,
      fullName: input.fullName,
      email: input.email,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  await logActivity({
    userId: profile.id,
    action: 'ADMIN_LOGIN',
    description: `${profile.fullName} was created as the initial admin`,
    entityType: 'Profile',
    entityId: profile.id,
  });

  return toAdminProfileDTO(profile);
}

/**
 * Forgot Password — step 1: send an OTP to a registered email.
 *
 * Always responds the same way whether or not the email is registered (no
 * account enumeration); an OTP row is only actually created when a matching
 * ACTIVE profile exists.
 */
export async function forgotPassword(input: ForgotPasswordInput) {
  const profile = await prisma.profile.findUnique({ where: { email: input.email.toLowerCase().trim() } });

  if (!profile || profile.status !== 'ACTIVE') {
    // Don't leak which emails exist — but don't hand back devOtp either.
    return { expiresInSeconds: 300 };
  }

  await logActivity({
    userId: profile.id,
    action: 'PASSWORD_RESET_REQUESTED',
    description: `${profile.fullName} requested a password reset`,
    entityType: 'Profile',
    entityId: profile.id,
  });

  return otpService.issueOtp(input.email, 'PASSWORD_RESET');
}

export async function resendPasswordResetOtp(input: ResendResetOtpInput) {
  const profile = await prisma.profile.findUnique({ where: { email: input.email.toLowerCase().trim() } });
  if (!profile || profile.status !== 'ACTIVE') {
    return { expiresInSeconds: 300 };
  }
  return otpService.issueOtp(input.email, 'PASSWORD_RESET');
}

/** Forgot Password — step 2: verify the OTP and mint a short-lived reset token. */
export async function verifyPasswordResetOtp(input: VerifyResetOtpInput) {
  const { otpId } = await otpService.verifyOtp(input.email, 'PASSWORD_RESET', input.code);
  return otpService.issueResetToken(otpId);
}

/** Forgot Password — step 3: redeem the reset token and set the new password. */
export async function resetPassword(input: ResetPasswordInput) {
  const { email } = await otpService.redeemResetToken(input.resetToken);

  const profile = await prisma.profile.findUnique({ where: { email } });
  if (!profile) {
    throw new UnauthorizedError('Could not reset the password. Please start the process again.');
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.authUserId, {
    password: input.newPassword,
  });
  if (error) {
    throw new UnauthorizedError('Could not update password. Please try again.');
  }

  // A password reset invalidates every existing session, same as a manual change.
  await prisma.session.updateMany({
    where: { userId: profile.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await logActivity({
    userId: profile.id,
    action: 'PASSWORD_RESET',
    description: `${profile.fullName} reset their password via OTP`,
    entityType: 'Profile',
    entityId: profile.id,
  });
}
