import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validation.middleware';
import {
  listNotificationsHandler,
  markAllNotificationsReadHandler,
  markNotificationReadHandler,
} from './notifications.controller';
import { notificationIdParamSchema, notificationsQuerySchema } from './notifications.validation';

const router = Router();

router.use(requireAuth);

router.get('/', validate(notificationsQuerySchema, 'query'), listNotificationsHandler);
router.patch('/read-all', markAllNotificationsReadHandler);
router.patch('/:id/read', validate(notificationIdParamSchema, 'params'), markNotificationReadHandler);

export default router;
