import { z } from 'zod';

export const staffQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).optional(),
  department: z.string().trim().optional(),
});

export const staffIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createStaffSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(5),
  department: z.string().min(1),
  designation: z.string().min(1),
  joiningDate: z.string().min(1),
  profileImage: z.string().url().nullable().optional(),
});

export const updateStaffSchema = z
  .object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(5).optional(),
    department: z.string().min(1).optional(),
    designation: z.string().min(1).optional(),
    joiningDate: z.string().min(1).optional(),
    profileImage: z.string().url().nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export type StaffQueryInput = z.infer<typeof staffQuerySchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
