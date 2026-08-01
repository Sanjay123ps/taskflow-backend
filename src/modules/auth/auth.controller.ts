import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { isProd } from '../../config/env';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../../utils/tokens';
import * as authService from './auth.service';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  InitialAdminSetupInput,
  LoginInput,
  ResendResetOtpInput,
  ResetPasswordInput,
  VerifyResetOtpInput,
} from './auth.validation';
import { UnauthorizedError } from '../../utils/errors';

function requestMeta(req: Request) {
  return { ipAddress: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}

export const loginHandler = asyncHandler(async (req: Request<unknown, unknown, LoginInput>, res: Response) => {
  const { email, password } = req.body;
  const { accessToken, refreshToken, ...profileData } = await authService.login(email, password, requestMeta(req));

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(isProd));
  sendSuccess(res, { accessToken, ...profileData }, 'Signed in successfully');
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  const { accessToken, refreshToken } = await authService.refresh(rawToken, requestMeta(req));

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(isProd));
  sendSuccess(res, { accessToken }, 'Token refreshed');
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  await authService.logout(rawToken);
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(isProd));
  sendSuccess(res, null, 'Signed out');
});

export const changePasswordHandler = asyncHandler(
  async (req: Request<unknown, unknown, ChangePasswordInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    await authService.changePassword(req.authUser.profileId, req.body.currentPassword, req.body.newPassword);
    sendSuccess(res, null, 'Password changed successfully');
  },
);

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const profile = await authService.getMe(req.authUser.profileId);
  sendSuccess(res, profile);
});

export const initialAdminSetupHandler = asyncHandler(
  async (req: Request<unknown, unknown, InitialAdminSetupInput>, res: Response) => {
    const admin = await authService.setupInitialAdmin(req.body);
    sendSuccess(res, admin, 'Initial admin account created', 201);
  },
);

export const forgotPasswordHandler = asyncHandler(
  async (req: Request<unknown, unknown, ForgotPasswordInput>, res: Response) => {
    const result = await authService.forgotPassword(req.body);
    sendSuccess(res, result, 'If that email is registered, an OTP has been sent to it');
  },
);

export const resendPasswordResetOtpHandler = asyncHandler(
  async (req: Request<unknown, unknown, ResendResetOtpInput>, res: Response) => {
    const result = await authService.resendPasswordResetOtp(req.body);
    sendSuccess(res, result, 'If that email is registered, a new OTP has been sent to it');
  },
);

export const verifyPasswordResetOtpHandler = asyncHandler(
  async (req: Request<unknown, unknown, VerifyResetOtpInput>, res: Response) => {
    const result = await authService.verifyPasswordResetOtp(req.body);
    sendSuccess(res, result, 'OTP verified');
  },
);

export const resetPasswordHandler = asyncHandler(
  async (req: Request<unknown, unknown, ResetPasswordInput>, res: Response) => {
    await authService.resetPassword(req.body);
    sendSuccess(res, null, 'Password reset successfully');
  },
);
