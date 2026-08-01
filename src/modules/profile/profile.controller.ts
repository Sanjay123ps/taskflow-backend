import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import * as profileService from './profile.service';
import type { UpdateStatusInput } from './profile.validation';

export const uploadProfilePhotoHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const profile = await profileService.uploadProfilePhoto(req.authUser, req.file);
  sendSuccess(res, profile, 'Profile photo updated');
});

export const removeProfilePhotoHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const profile = await profileService.removeProfilePhoto(req.authUser);
  sendSuccess(res, profile, 'Profile photo removed');
});

export const getMyStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const status = await profileService.getMyStatus(req.authUser);
  sendSuccess(res, status);
});

export const updateMyStatusHandler = asyncHandler(
  async (req: Request<unknown, unknown, UpdateStatusInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const status = await profileService.updateMyStatus(req.authUser, req.body);
    sendSuccess(res, status, 'Status updated');
  },
);
