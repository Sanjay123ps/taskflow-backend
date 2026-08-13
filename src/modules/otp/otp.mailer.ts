import type { OtpPurpose } from '@prisma/client';
import { getMailTransporter, mailFrom } from '../../config/mailer';
import { logger } from '../../config/logger';

interface OtpEmailCopy {
  subject: string;
  heading: string;
  body: string;
}

function copyFor(purpose: OtpPurpose): OtpEmailCopy {
  switch (purpose) {
    case 'SIGNUP_VERIFY':
      return {
        subject: 'Verify your TaskFlow account',
        heading: 'Confirm your email',
        body: 'Use the code below to verify your email and finish creating your TaskFlow staff account.',
      };
    case 'ADMIN_SIGNUP_VERIFY':
      return {
        subject: 'Verify your TaskFlow admin account',
        heading: 'Confirm your email',
        body: 'Use the code below to verify your email and finish creating your TaskFlow admin account.',
      };
    case 'PASSWORD_RESET':
      return {
        subject: 'Reset your TaskFlow password',
        heading: 'Reset your password',
        body: "Use the code below to reset your TaskFlow password. If you didn't request this, you can safely ignore this email.",
      };
    default:
      return {
        subject: 'Your TaskFlow verification code',
        heading: 'Verification code',
        body: 'Use the code below to continue.',
      };
  }
}

function renderHtml(copy: OtpEmailCopy, code: string, minutes: number): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:32px;">
          <h1 style="font-size:18px;margin:0 0 8px;">${copy.heading}</h1>
          <p style="font-size:14px;line-height:1.5;color:#4b5563;margin:0 0 24px;">${copy.body}</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#f0f4ff;border-radius:8px;color:#3730a3;">${code}</div>
          <p style="font-size:12px;color:#9ca3af;margin:24px 0 0;">This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}. If you didn't request this, you can ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(copy: OtpEmailCopy, code: string, minutes: number): string {
  return `${copy.heading}\n\n${copy.body}\n\nYour code: ${code}\n\nThis code expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * Sends an OTP code by email. Never throws — the OTP is already stored and
 * valid by the time this is called, so a delivery failure shouldn't break
 * the request; it just means the user needs to hit Resend. Logs instead of
 * sending when SMTP isn't configured (dev/test only — see mailer.ts).
 */
export async function sendOtpEmail(
  email: string,
  code: string,
  purpose: OtpPurpose,
  expiresInSeconds: number,
): Promise<void> {
  const transporter = getMailTransporter();
  const minutes = Math.max(1, Math.round(expiresInSeconds / 60));

  if (!transporter) {
    logger.info({ email, purpose }, 'SMTP not configured — OTP email not sent (see devOtp in the API response)');
    return;
  }

  const copy = copyFor(purpose);

  try {
    await transporter.sendMail({
      from: mailFrom(),
      to: email,
      subject: copy.subject,
      html: renderHtml(copy, code, minutes),
      text: renderText(copy, code, minutes),
    });
  } catch (err) {
    logger.error({ err, email, purpose }, 'Failed to send OTP email');
  }
}
