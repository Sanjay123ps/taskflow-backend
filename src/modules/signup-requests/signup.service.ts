import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { supabaseAdmin } from '../../config/supabase';
import { toSignupRequestDTO } from '../../utils/dto';
import { buildPaginatedResult, normalizePagination } from '../../utils/pagination';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { nextEmployeeId } from '../../utils/employeeId';
import { verifyCaptcha } from '../../utils/captcha';
import { logActivity } from '../activities/activity.service';
import { createNotification } from '../notifications/notifications.service';
import * as otpService from '../otp/otp.service';
import type {
  ResendSignupOtpInput,
  SignupQueryInput,
  SubmitSignupRequestInput,
  VerifySignupOtpInput,
} from './signup.validation';

const requestInclude = { reviewedBy: true, profile: true } as const;

export async function submitSignupRequest(input: SubmitSignupRequestInput) {
  await verifyCaptcha(input.captchaToken);

  const normalizedEmail = input.email.toLowerCase().trim();
  const existingProfile = await prisma.profile.findUnique({ where: { email: input.email } });

  if (existingProfile) {
    // A profile row already exists for this email. Most of the time that
    // really does mean "already registered" — but if it's a STAFF profile
    // that's still PENDING and never got its email verified, the person
    // simply lost the OTP screen (closed the tab, browser restart, etc.)
    // before finishing signup. There's no other way back into that flow
    // (see SignupVerifyOtp.tsx), so treat resubmitting the same email here
    // as "resume my signup" instead of permanently locking the account out.
    if (existingProfile.role === 'STAFF' && existingProfile.status === 'PENDING' && !existingProfile.emailVerifiedAt) {
      const existingRequest = await prisma.staffSignupRequest.findFirst({
        where: { profileId: existingProfile.id, status: 'PENDING' },
        include: requestInclude,
      });
      if (existingRequest) {
        const otp = await otpService.issueOtp(normalizedEmail, 'SIGNUP_VERIFY');
        return { request: toSignupRequestDTO(existingRequest), otp };
      }
    }

    if (existingProfile.status === 'PENDING' && existingProfile.emailVerifiedAt) {
      throw new ConflictError('This email is already verified and awaiting admin approval.');
    }

    throw new ConflictError('An account with this email already exists.');
  }

  const existingPendingRequest = await prisma.staffSignupRequest.findFirst({
    where: { email: input.email, status: 'PENDING' },
  });
  if (existingPendingRequest) {
    throw new ConflictError('A signup request for this email is already pending review.');
  }

  // Hand the password straight to Supabase Auth — it is hashed there and
  // never touches our database. The profile starts PENDING so login stays
  // blocked (see auth.middleware) until an admin approves the request.
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
        phone: input.phone,
        role: 'STAFF',
        status: 'PENDING',
      },
    });

    return tx.staffSignupRequest.create({
      data: {
        profileId: profile.id,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        status: 'PENDING',
      },
      include: requestInclude,
    });
  });

  await logActivity({
    userId: request.profileId,
    action: 'SIGNUP_REQUEST_SUBMITTED',
    description: `${input.fullName} submitted a staff signup request`,
    entityType: 'StaffSignupRequest',
    entityId: request.id,
  });

  // Admins are only notified once the staff member has verified their email
  // (see verifySignupOtp below) — a signup with an unconfirmed email address
  // shouldn't show up in the Admin approval queue yet. Issue the first OTP
  // now so the frontend can move straight to the "Verify Your Email" step.
  const otp = await otpService.issueOtp(input.email, 'SIGNUP_VERIFY');

  return { request: toSignupRequestDTO(request), otp };
}

/**
 * Confirms the 4-digit OTP sent after signup, marks the Profile's email as
 * verified, and — only at this point — notifies admins that a new signup
 * request is awaiting their review.
 */
export async function verifySignupOtp(input: VerifySignupOtpInput) {
  const { otpId } = await otpService.verifyOtp(input.email, 'SIGNUP_VERIFY', input.code);
  await otpService.consumeOtp(otpId);

  const profile = await prisma.profile.findUnique({ where: { email: input.email.toLowerCase().trim() } });
  if (!profile) {
    throw new BadRequestError('No pending signup found for this email.');
  }

  const updated = await prisma.profile.update({
    where: { id: profile.id },
    data: { emailVerifiedAt: new Date() },
  });

  await logActivity({
    userId: updated.id,
    action: 'SIGNUP_EMAIL_VERIFIED',
    description: `${updated.fullName} verified their email address`,
    entityType: 'Profile',
    entityId: updated.id,
  });

  const request = await prisma.staffSignupRequest.findUnique({
    where: { profileId: updated.id },
    include: requestInclude,
  });

  if (request && request.status === 'PENDING') {
    const admins = await prisma.profile.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' } });
    await Promise.all(
      admins.map((admin) =>
        createNotification({
          userId: admin.id,
          type: 'SIGNUP_REQUEST',
          title: 'New staff signup request',
          message: `${updated.fullName} (${updated.email}) is awaiting approval.`,
          entityType: 'StaffSignupRequest',
          entityId: request.id,
        }),
      ),
    );
  }

  return { verified: true };
}

export async function resendSignupOtp(input: ResendSignupOtpInput) {
  return otpService.issueOtp(input.email, 'SIGNUP_VERIFY');
}

export async function listSignupRequests(params: SignupQueryInput) {
  const pagination = normalizePagination(params);
  const where: Prisma.StaffSignupRequestWhereInput =
    params.status && params.status !== 'ALL' ? { status: params.status } : {};

  const [rows, total] = await Promise.all([
    prisma.staffSignupRequest.findMany({
      where,
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.staffSignupRequest.count({ where }),
  ]);

  return buildPaginatedResult(rows.map(toSignupRequestDTO), total, pagination);
}

export async function getSignupRequest(id: string) {
  const request = await prisma.staffSignupRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new NotFoundError('Signup request not found');
  return toSignupRequestDTO(request);
}

export async function approveSignupRequest(id: string, reviewedByProfileId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.staffSignupRequest.findUnique({ where: { id }, include: requestInclude });
    if (!request) throw new NotFoundError('Signup request not found');
    if (request.status !== 'PENDING') {
      throw new ConflictError('This request has already been reviewed.');
    }
    if (!request.profileId) {
      throw new ConflictError('This request has no associated account to approve.');
    }
    if (!request.profile?.emailVerifiedAt) {
      throw new ConflictError('This staff member has not verified their email address yet.');
    }

    const employeeId = await nextEmployeeId(tx);

    await tx.profile.update({
      where: { id: request.profileId },
      data: { status: 'ACTIVE', employeeId },
    });

    const updated = await tx.staffSignupRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewedByProfileId, reviewedAt: new Date() },
      include: requestInclude,
    });

    await logActivity(
      {
        userId: reviewedByProfileId,
        action: 'SIGNUP_REQUEST_APPROVED',
        description: `Approved signup request for ${request.fullName} (assigned ${employeeId})`,
        entityType: 'StaffSignupRequest',
        entityId: id,
      },
      tx,
    );

    return updated;
  });

  if (result.profileId) {
    await createNotification({
      userId: result.profileId,
      type: 'SIGNUP_REQUEST_APPROVED',
      title: 'Your account has been approved',
      message: 'You can now sign in to TaskFlow.',
      entityType: 'StaffSignupRequest',
      entityId: id,
    });
  }

  return toSignupRequestDTO(result);
}

export async function rejectSignupRequest(id: string, reviewedByProfileId: string, reason: string | undefined) {
  const request = await prisma.staffSignupRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new NotFoundError('Signup request not found');
  if (request.status !== 'PENDING') {
    throw new ConflictError('This request has already been reviewed.');
  }

  const updated = await prisma.staffSignupRequest.update({
    where: { id },
    data: { status: 'REJECTED', reviewedById: reviewedByProfileId, reviewedAt: new Date(), rejectionReason: reason },
    include: requestInclude,
  });

  // Clean up the never-activated auth user + profile rather than leaving a
  // permanently PENDING account around. The request row itself survives
  // (profileId is nullable, set null via onDelete: SetNull) so the audit
  // trail (name/email/status/reason) is preserved.
  if (request.profile) {
    await prisma.profile.delete({ where: { id: request.profile.id } }).catch(() => undefined);
    await supabaseAdmin.auth.admin.deleteUser(request.profile.authUserId).catch(() => undefined);
  }

  await logActivity({
    userId: reviewedByProfileId,
    action: 'SIGNUP_REQUEST_REJECTED',
    description: `Rejected signup request for ${request.fullName}${reason ? `: ${reason}` : ''}`,
    entityType: 'StaffSignupRequest',
    entityId: id,
  });

  return toSignupRequestDTO(updated);
}