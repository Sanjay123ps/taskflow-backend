import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from './env';
import { logger } from './logger';

/**
 * Lazily-created SMTP transporter, cached after the first call.
 *
 * Returns `null` when SMTP isn't configured. That's only possible outside
 * production — `env.ts` requires SMTP_HOST/USER/PASS/FROM_EMAIL whenever
 * NODE_ENV=production, so a null transporter in prod can't happen; the app
 * won't have booted. Callers (see `otp.mailer.ts`) treat null as "email
 * delivery unavailable, fall back to logging" rather than a silent no-op.
 */
let transporter: Transporter | null = null;
let attempted = false;

export function getMailTransporter(): Transporter | null {
  if (attempted) return transporter;
  attempted = true;

  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.SMTP_FROM_EMAIL) {
    logger.warn(
      'SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM_EMAIL) — emails will only be logged, not sent. This is only valid outside production.',
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // true for port 465, false for 587/STARTTLS
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  return transporter;
}

export function mailFrom(): string {
  return `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL ?? 'no-reply@taskflow.local'}>`;
}
