import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import * as staffService from './staff.service';
import type { CreateStaffInput, StaffQueryInput, UpdateStaffInput } from './staff.validation';

export const listStaffHandler = asyncHandler(async (req: Request<unknown, unknown, unknown, StaffQueryInput>, res: Response) => {
  const result = await staffService.listStaff(req.query);
  sendSuccess(res, result);
});

export const getStaffHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const staff = await staffService.getStaffMember(req.params.id);
  sendSuccess(res, staff);
});

export const createStaffHandler = asyncHandler(
  async (req: Request<unknown, unknown, CreateStaffInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const staff = await staffService.createStaff(req.body, req.authUser.profileId);
    sendCreated(res, staff, 'Staff account created and invite email sent');
  },
);

export const updateStaffHandler = asyncHandler(
  async (req: Request<{ id: string }, unknown, UpdateStaffInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const staff = await staffService.updateStaff(req.params.id, req.body, req.authUser.profileId);
    sendSuccess(res, staff, 'Staff profile updated');
  },
);

export const resetStaffPasswordHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const result = await staffService.resetStaffPassword(req.params.id, req.authUser.profileId);
  sendSuccess(res, result, 'Temporary password generated');
});
