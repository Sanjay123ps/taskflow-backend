import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import * as adminSignupService from './adminSignup.service';
import type {
  AdminSignupEmailInput,
  AdminSignupQueryInput,
  SubmitAdminSignupInput,
  VerifyAdminSignupOtpInput,
} from './adminSignup.validation';

export const submitAdminSignupHandler = asyncHandler(
  async (req: Request<unknown, unknown, SubmitAdminSignupInput>, res: Response) => {
    const result = await adminSignupService.submitAdminSignup(req.body);
    sendCreated(res, result, 'Verification code sent — check your email to continue.');
  },
);

export const resendAdminSignupOtpHandler = asyncHandler(
  async (req: Request<unknown, unknown, AdminSignupEmailInput>, res: Response) => {
    await adminSignupService.resendAdminSignupOtp(req.body.email);
    sendSuccess(res, null, 'If that request is still pending, a new code has been sent.');
  },
);

export const verifyAdminSignupOtpHandler = asyncHandler(
  async (req: Request<unknown, unknown, VerifyAdminSignupOtpInput>, res: Response) => {
    await adminSignupService.verifyAdminSignupOtp(req.body.email, req.body.code);
    sendSuccess(res, null, 'Email verified — an admin will review your request shortly.');
  },
);

export const listAdminSignupRequestsHandler = asyncHandler(
  async (req: Request<unknown, unknown, unknown, AdminSignupQueryInput>, res: Response) => {
    const result = await adminSignupService.listAdminSignupRequests(req.query);
    sendSuccess(res, result);
  },
);

export const getAdminSignupRequestHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const request = await adminSignupService.getAdminSignupRequest(req.params.id);
  sendSuccess(res, request);
});

export const approveAdminSignupRequestHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const request = await adminSignupService.approveAdminSignupRequest(req.params.id, req.authUser.profileId);
  sendSuccess(res, request, 'Admin signup approved');
});

export const rejectAdminSignupRequestHandler = asyncHandler(
  async (req: Request<{ id: string }, unknown, { reason?: string }>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const request = await adminSignupService.rejectAdminSignupRequest(
      req.params.id,
      req.authUser.profileId,
      req.body.reason,
    );
    sendSuccess(res, request, 'Admin signup rejected');
  },
);
