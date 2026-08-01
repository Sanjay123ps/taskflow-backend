import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string; // Profile.id
  authUserId: string;
  role: UserRole;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
}

/**
 * Refresh tokens are opaque random strings — the raw value is set as an
 * httpOnly cookie and returned to the client only once; we persist just a
 * SHA-256 hash of it in the Session table, so a database leak alone can
 * never be replayed as a valid refresh token.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('hex');
  const hash = hashRefreshToken(token);
  return { token, hash };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const REFRESH_COOKIE_NAME = 'taskflow_refresh_token';

export function refreshTokenExpiryDate(): Date {
  const days = env.REFRESH_TOKEN_EXPIRES_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Cookie options for the refresh-token cookie. Admin/Staff frontends are
 * on a different origin (Vercel) than this API (Render), so the cookie
 * must be SameSite=None + Secure in production for the browser to send it
 * cross-site at all; in local dev (same-ish origin, http) we relax both.
 */
export function refreshCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/api/v1',
    maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
  };
}
