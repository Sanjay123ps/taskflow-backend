import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import * as signupService from './signup.service';
import type {
  ResendSignupOtpInput,
  SignupQueryInput,
  SubmitSignupRequestInput,
  VerifySignupOtpInput,
} from './signup.validation';

export const submitSignupRequestHandler = asyncHandler(
  async (req: Request<unknown, unknown, SubmitSignupRequestInput>, res: Response) => {
    const { request, otp } = await signupService.submitSignupRequest(req.body);
    sendCreated(res, { request, ...otp }, 'Signup submitted — enter the OTP sent to your email to continue');
  },
);

export const verifySignupOtpHandler = asyncHandler(
  async (req: Request<unknown, unknown, VerifySignupOtpInput>, res: Response) => {
    const result = await signupService.verifySignupOtp(req.body);
    sendSuccess(res, result, 'Email verified successfully');
  },
);

export const resendSignupOtpHandler = asyncHandler(
  async (req: Request<unknown, unknown, ResendSignupOtpInput>, res: Response) => {
    const result = await signupService.resendSignupOtp(req.body);
    sendSuccess(res, result, 'A new OTP has been sent to your email');
  },
);

export const listSignupRequestsHandler = asyncHandler(
  async (req: Request<unknown, unknown, unknown, SignupQueryInput>, res: Response) => {
    const result = await signupService.listSignupRequests(req.query);
    sendSuccess(res, result);
  },
);

export const getSignupRequestHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const request = await signupService.getSignupRequest(req.params.id);
  sendSuccess(res, request);
});

export const approveSignupRequestHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const request = await signupService.approveSignupRequest(req.params.id, req.authUser.profileId);
  sendSuccess(res, request, 'Signup request approved');
});

export const rejectSignupRequestHandler = asyncHandler(
  async (req: Request<{ id: string }, unknown, { reason?: string }>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const request = await signupService.rejectSignupRequest(req.params.id, req.authUser.profileId, req.body.reason);
    sendSuccess(res, request, 'Signup request rejected');
  },
);
