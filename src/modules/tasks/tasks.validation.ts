import { z } from 'zod';

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const statusEnum = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']);

export const taskQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  staffId: z.string().uuid().optional(),
  priority: z.union([priorityEnum, z.literal('ALL')]).optional(),
  status: z.union([statusEnum, z.literal('ALL')]).optional(),
  overdueOnly: z.coerce.boolean().optional(),
  excludeCompleted: z.coerce.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().trim().optional(),
});

export const taskIdParamSchema = z.object({ id: z.string().uuid() });

// multipart/form-data arrives as strings, so this schema coerces.
export const createTaskSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(1),
  assignedToId: z.string().uuid(),
  priority: priorityEnum,
  dueDate: z.string().min(1),
  dueTime: z.string().min(1),
  notes: z.string().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().min(2).optional(),
    description: z.string().min(1).optional(),
    assignedToId: z.string().uuid().optional(),
    priority: priorityEnum.optional(),
    status: statusEnum.optional(),
    dueDate: z.string().min(1).optional(),
    dueTime: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const addCommentSchema = z.object({
  message: z.string().min(1).max(2000),
});

export type TaskQueryInput = z.infer<typeof taskQuerySchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
