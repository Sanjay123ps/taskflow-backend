import { env } from '../config/env';
import { BadRequestError } from './errors';
import { logger } from '../config/logger';

/**
 * Verifies a CAPTCHA token server-side. Written against hCaptcha's
 * `siteverify` endpoint (Supabase's built-in CAPTCHA integration also
 * defaults to hCaptcha). If the project uses reCAPTCHA instead, only this
 * function needs to change — swap the URL to
 * https://www.google.com/recaptcha/api/siteverify (same response shape).
 *
 * If CAPTCHA_SECRET_KEY is not configured, verification is skipped with a
 * warning — useful for local development — but should always be set in
 * production.
 */
export async function verifyCaptcha(token: string | undefined): Promise<void> {
  if (!env.CAPTCHA_SECRET_KEY) {
    logger.warn('CAPTCHA_SECRET_KEY not set — skipping CAPTCHA verification (do not do this in production).');
    return;
  }

  if (!token) {
    throw new BadRequestError('CAPTCHA verification is required.');
  }

  const params = new URLSearchParams({ secret: env.CAPTCHA_SECRET_KEY, response: token });

  const response = await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const result = (await response.json()) as { success: boolean };

  if (!result.success) {
    throw new BadRequestError('CAPTCHA verification failed. Please try again.');
  }
}
