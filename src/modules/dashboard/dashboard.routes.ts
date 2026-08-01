import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin, requireStaff } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import * as dashboardService from './dashboard.service';
import { dashboardQuerySchema, type DashboardQueryInput } from './dashboard.validation';

const adminDashboardHandler = asyncHandler(
  async (req: Request<unknown, unknown, unknown, DashboardQueryInput>, res: Response) => {
    const summary = await dashboardService.getAdminDashboardSummary(req.query);
    sendSuccess(res, summary);
  },
);

const staffDashboardHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const summary = await dashboardService.getStaffDashboardSummary(req.authUser);
  sendSuccess(res, summary);
});

export const adminDashboardRouter = Router();
adminDashboardRouter.get(
  '/dashboard',
  requireAuth,
  requireAdmin,
  validate(dashboardQuerySchema, 'query'),
  adminDashboardHandler,
);

export const staffDashboardRouter = Router();
staffDashboardRouter.get('/dashboard', requireAuth, requireStaff, staffDashboardHandler);
