import { z } from 'zod';

export const submitAdminRequestSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
});

export const adminRequestQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ALL']).optional(),
});

export const adminRequestIdParamSchema = z.object({ id: z.string().uuid() });

export const rejectAdminRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type SubmitAdminRequestInput = z.infer<typeof submitAdminRequestSchema>;
export type AdminRequestQueryInput = z.infer<typeof adminRequestQuerySchema>;
