import crypto from 'crypto';
import type { OtpPurpose } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { isProd } from '../../config/env';
import { BadRequestError, TooManyRequestsError } from '../../utils/errors';

/**
 * Real, DB-backed 4-digit OTP codes. SMTP is not wired up yet, so instead of
 * emailing the code this simply logs it server-side; in non-production
 * environments it is also handed back in the response (`devOtp`) so the
 * frontend OTP flow can be exercised end-to-end without a mail provider.
 * Verification itself (hashing, expiry, attempt limits, single-use) is real.
 */

const OTP_LENGTH = 4;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // matches the "Resend OTP (00:30)" UI
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // window to complete "Create New Password" after OTP verification

function generateNumericCode(length: number): string {
  const max = 10 ** length;
  const code = crypto.randomInt(0, max);
  return String(code).padStart(length, '0');
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface IssueOtpResult {
  expiresInSeconds: number;
  /** Only populated outside production — see module docblock. */
  devOtp?: string;
}

/**
 * Creates and stores a fresh OTP for (email, purpose), invalidating any
 * still-pending code for that same pair first so only the latest one is
 * ever valid. Used for both the first send and manual "Resend OTP".
 */
export async function issueOtp(email: string, purpose: OtpPurpose): Promise<IssueOtpResult> {
  const normalizedEmail = email.toLowerCase().trim();

  const recent = await prisma.otpVerification.findFirst({
    where: { email: normalizedEmail, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new TooManyRequestsError('Please wait a moment before requesting another OTP.');
  }

  // Invalidate any still-outstanding codes for this email/purpose so only
  // the newest one can ever be verified.
  await prisma.otpVerification.updateMany({
    where: { email: normalizedEmail, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateNumericCode(OTP_LENGTH);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.otpVerification.create({
    data: {
      email: normalizedEmail,
      purpose,
      codeHash: hashCode(code),
      expiresAt,
    },
  });

  logger.info({ email: normalizedEmail, purpose }, `OTP generated (SMTP not yet integrated): ${code}`);

  return {
    expiresInSeconds: OTP_TTL_MS / 1000,
    ...(isProd ? {} : { devOtp: code }),
  };
}

export interface VerifyOtpResult {
  otpId: string;
}

/**
 * Verifies a submitted code against the latest outstanding OTP for
 * (email, purpose). Throws on: no pending OTP, expired OTP, too many wrong
 * attempts, or a mismatched code — each with a distinct message so the UI
 * can show the right state (expired vs. invalid).
 */
export async function verifyOtp(email: string, purpose: OtpPurpose, code: string): Promise<VerifyOtpResult> {
  const normalizedEmail = email.toLowerCase().trim();

  const otp = await prisma.otpVerification.findFirst({
    where: { email: normalizedEmail, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) {
    throw new BadRequestError('This OTP has expired. Please request a new OTP.');
  }

  if (otp.expiresAt < new Date()) {
    await prisma.otpVerification.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    throw new BadRequestError('This OTP has expired. Please request a new OTP.');
  }

  if (otp.attempts >= otp.maxAttempts) {
    await prisma.otpVerification.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    throw new BadRequestError('This OTP has expired. Please request a new OTP.');
  }

  if (otp.codeHash !== hashCode(code)) {
    await prisma.otpVerification.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new BadRequestError('Invalid OTP. Please try again.');
  }

  await prisma.otpVerification.update({
    where: { id: otp.id },
    data: { verified: true, verifiedAt: new Date() },
  });

  return { otpId: otp.id };
}

/**
 * Marks a just-verified OTP fully consumed (used once the caller has acted
 * on the verification — e.g. flipping Profile.emailVerifiedAt for signup).
 */
export async function consumeOtp(otpId: string): Promise<void> {
  await prisma.otpVerification.update({ where: { id: otpId }, data: { consumedAt: new Date() } });
}

/**
 * Issues a short-lived, single-use reset token for a verified
 * PASSWORD_RESET OTP, so "Create New Password" doesn't need the OTP again.
 * The raw token is returned once; only its hash is persisted.
 */
export async function issueResetToken(otpId: string): Promise<{ resetToken: string; expiresInSeconds: number }> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.otpVerification.update({
    where: { id: otpId },
    data: { resetTokenHash: hashToken(rawToken), resetTokenExpiresAt, consumedAt: new Date() },
  });

  return { resetToken: rawToken, expiresInSeconds: RESET_TOKEN_TTL_MS / 1000 };
}

/**
 * Redeems a reset token minted by `issueResetToken`, returning the email it
 * was issued for. Single-use: the row's resetTokenHash is cleared so the
 * same token can never be replayed.
 */
export async function redeemResetToken(rawToken: string): Promise<{ email: string }> {
  const tokenHash = hashToken(rawToken);
  const otp = await prisma.otpVerification.findUnique({ where: { resetTokenHash: tokenHash } });

  if (!otp || !otp.resetTokenExpiresAt || otp.resetTokenExpiresAt < new Date()) {
    throw new BadRequestError('This reset link has expired. Please start the password reset again.');
  }

  await prisma.otpVerification.update({
    where: { id: otp.id },
    data: { resetTokenHash: null, resetTokenExpiresAt: null },
  });

  return { email: otp.email };
}
