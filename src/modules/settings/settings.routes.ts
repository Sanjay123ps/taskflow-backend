import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { REFRESH_COOKIE_NAME } from '../../utils/tokens';
import * as settingsService from './settings.service';
import {
  accountSettingsSchema,
  generalSettingsSchema,
  notificationPreferencesSchema,
  taskSettingsSchema,
  type AccountSettingsInput,
  type GeneralSettingsInput,
  type NotificationPreferencesInput,
  type TaskSettingsInput,
} from './settings.validation';

const getGeneralHandler = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await settingsService.getGeneralSettings());
});

const updateGeneralHandler = asyncHandler(
  async (req: Request<unknown, unknown, GeneralSettingsInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const updated = await settingsService.updateGeneralSettings(req.body, req.authUser.profileId);
    sendSuccess(res, updated, 'General settings updated');
  },
);

const updateAccountHandler = asyncHandler(
  async (req: Request<unknown, unknown, AccountSettingsInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const updated = await settingsService.updateAccountSettings(req.body, req.authUser);
    sendSuccess(res, updated, 'Account settings updated');
  },
);

const getTaskSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await settingsService.getTaskSettings());
});

const updateTaskSettingsHandler = asyncHandler(
  async (req: Request<unknown, unknown, TaskSettingsInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const updated = await settingsService.updateTaskSettings(req.body, req.authUser.profileId);
    sendSuccess(res, updated, 'Task settings updated');
  },
);

const getNotificationPreferencesHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const prefs = await settingsService.getNotificationPreferences(req.authUser.profileId);
  sendSuccess(res, prefs);
});

const updateNotificationPreferencesHandler = asyncHandler(
  async (req: Request<unknown, unknown, NotificationPreferencesInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const updated = await settingsService.updateNotificationPreferences(req.body, req.authUser.profileId);
    sendSuccess(res, updated, 'Notification preferences updated');
  },
);

const listSessionsHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  const sessions = await settingsService.listActiveSessions(req.authUser, rawToken);
  sendSuccess(res, sessions);
});

const logoutAllHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  await settingsService.logoutAllSessions(req.authUser);
  sendSuccess(res, null, 'Signed out of all sessions');
});

const router = Router();
router.use(requireAuth);

router.get('/general', requireAdmin, getGeneralHandler);
router.patch('/general', requireAdmin, validate(generalSettingsSchema), updateGeneralHandler);

router.patch('/account', validate(accountSettingsSchema), updateAccountHandler);

// Personal to the authenticated user — no :userId param, nothing to spoof.
router.get('/notifications', getNotificationPreferencesHandler);
router.patch('/notifications', validate(notificationPreferencesSchema), updateNotificationPreferencesHandler);

router.get('/tasks', requireAdmin, getTaskSettingsHandler);
router.patch('/tasks', requireAdmin, validate(taskSettingsSchema), updateTaskSettingsHandler);

router.get('/sessions', listSessionsHandler);
router.post('/sessions/logout-all', logoutAllHandler);

export default router;
