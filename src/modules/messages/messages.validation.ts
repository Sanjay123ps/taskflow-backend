import { z } from 'zod';

export const sendMessageSchema = z.object({
  receiverId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  message: z.string().min(1).max(2000),
});

export const threadParamSchema = z.object({ userId: z.string().uuid() });

export const threadQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const messageIdParamSchema = z.object({ id: z.string().uuid() });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ThreadQueryInput = z.infer<typeof threadQuerySchema>;
