import { z } from 'zod';

export const notificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  unreadOnly: z.coerce.boolean().optional(),
});

export const notificationIdParamSchema = z.object({ id: z.string().uuid() });

export type NotificationsQueryInput = z.infer<typeof notificationsQuerySchema>;
