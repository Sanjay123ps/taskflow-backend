import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import * as notificationsService from './notifications.service';
import type { NotificationsQueryInput } from './notifications.validation';

export const listNotificationsHandler = asyncHandler(
  async (req: Request<unknown, unknown, unknown, NotificationsQueryInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const result = await notificationsService.listNotifications(req.authUser.profileId, req.query);
    sendSuccess(res, result);
  },
);

export const markNotificationReadHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const notification = await notificationsService.markNotificationRead(req.params.id, req.authUser.profileId);
  sendSuccess(res, notification, 'Notification marked as read');
});

export const markAllNotificationsReadHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  await notificationsService.markAllNotificationsRead(req.authUser.profileId);
  sendSuccess(res, null, 'All notifications marked as read');
});
