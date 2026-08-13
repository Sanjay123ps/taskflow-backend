import { z } from 'zod';
import { emailSchema } from '../../utils/validation';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const initialAdminSetupSchema = z.object({
  setupToken: z.string().min(1),
  fullName: z.string().min(2),
  email: emailSchema,
  password: z.string().min(8),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const verifyResetOtpSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{4}$/, 'Enter the 4-digit code'),
});

export const resendResetOtpSchema = z.object({
  email: emailSchema,
});

const passwordStrengthSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a special character');

export const resetPasswordSchema = z
  .object({
    resetToken: z.string().min(1),
    newPassword: passwordStrengthSchema,
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type InitialAdminSetupInput = z.infer<typeof initialAdminSetupSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyResetOtpInput = z.infer<typeof verifyResetOtpSchema>;
export type ResendResetOtpInput = z.infer<typeof resendResetOtpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
