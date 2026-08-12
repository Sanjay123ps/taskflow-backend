import { z } from 'zod';
import { emailSchema } from '../../utils/validation';

export const submitAdminSignupSchema = z
  .object({
    fullName: z.string().min(2),
    email: emailSchema,
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8),
    captchaToken: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const adminSignupEmailSchema = z.object({
  email: emailSchema,
});

export const verifyAdminSignupOtpSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{4}$/, 'Code must be 4 digits'),
});

export const adminSignupQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ALL']).optional(),
});

export const adminSignupIdParamSchema = z.object({ id: z.string().uuid() });

export const rejectAdminSignupSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type SubmitAdminSignupInput = z.infer<typeof submitAdminSignupSchema>;
export type AdminSignupEmailInput = z.infer<typeof adminSignupEmailSchema>;
export type VerifyAdminSignupOtpInput = z.infer<typeof verifyAdminSignupOtpSchema>;
export type AdminSignupQueryInput = z.infer<typeof adminSignupQuerySchema>;
