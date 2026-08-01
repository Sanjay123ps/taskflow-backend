import { z } from 'zod';

export const submitSignupRequestSchema = z
  .object({
    fullName: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(5).optional(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8),
    captchaToken: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const signupQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ALL']).optional(),
});

export const signupIdParamSchema = z.object({ id: z.string().uuid() });

export const rejectSignupRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const verifySignupOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{4}$/, 'Enter the 4-digit code'),
});

export const resendSignupOtpSchema = z.object({
  email: z.string().email(),
});

export type SubmitSignupRequestInput = z.infer<typeof submitSignupRequestSchema>;
export type SignupQueryInput = z.infer<typeof signupQuerySchema>;
export type VerifySignupOtpInput = z.infer<typeof verifySignupOtpSchema>;
export type ResendSignupOtpInput = z.infer<typeof resendSignupOtpSchema>;
