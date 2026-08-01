import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import * as attendanceService from './attendance.service';
import type { AttendanceQueryInput } from './attendance.validation';

export const listAttendanceHandler = asyncHandler(
  async (req: Request<unknown, unknown, unknown, AttendanceQueryInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const result = await attendanceService.listAttendance(req.query, req.authUser);
    sendSuccess(res, result);
  },
);

export const getAttendanceHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const record = await attendanceService.getAttendanceById(req.params.id, req.authUser);
  sendSuccess(res, record);
});

export const listStaffAttendanceHandler = asyncHandler(
  async (req: Request<{ staffId: string }, unknown, unknown, AttendanceQueryInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const result = await attendanceService.listStaffAttendance(req.params.staffId, req.query, req.authUser);
    sendSuccess(res, result);
  },
);

export const getAttendanceSummaryHandler = asyncHandler(async (_req: Request, res: Response) => {
  const summary = await attendanceService.getAttendanceSummary();
  sendSuccess(res, summary);
});

export const getMyAttendanceHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const record = await attendanceService.getMyAttendanceToday(req.authUser);
  sendSuccess(res, record);
});

export const checkInHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const record = await attendanceService.checkIn(req.authUser);
  sendSuccess(res, record, 'Arrival recorded');
});

export const checkOutHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const record = await attendanceService.checkOut(req.authUser);
  sendSuccess(res, record, 'Logout recorded');
});
