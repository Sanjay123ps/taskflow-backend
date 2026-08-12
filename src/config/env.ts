import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),

    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().default(30),

    FRONTEND_ADMIN_URL: z.string().url(),
    FRONTEND_STAFF_URL: z.string().url(),

    CAPTCHA_SECRET_KEY: z.string().optional(),

    INITIAL_ADMIN_SETUP_TOKEN: z.string().min(16).optional(),

    TASK_ATTACHMENTS_BUCKET: z.string().default('task-attachments'),
    PROFILE_IMAGES_BUCKET: z.string().default('profile-images'),
    MAX_UPLOAD_SIZE_MB: z.coerce.number().default(10),

    // SMTP — required in production (see .superRefine below) so OTP emails
    // (signup verify, admin signup verify, forgot password) can actually be
    // delivered. Optional in dev/test: issueOtp() falls back to devOtp/log
    // when unset, same as before this was wired up.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_SECURE: z.coerce.boolean().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM_EMAIL: z.string().email().optional(),
    SMTP_FROM_NAME: z.string().default('TaskFlow'),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV !== 'production') return;

    const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_EMAIL'] as const;
    for (const key of required) {
      if (!val[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required in production — without it, OTP codes (signup, password reset) cannot be emailed to users.`,
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables — see log above.');
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
