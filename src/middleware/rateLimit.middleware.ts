import rateLimit from 'express-rate-limit';
import { sendError } from '../utils/apiResponse';

/** General API traffic: generous, just to blunt abuse/bots. */
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => sendError(res, 429, 'Too many requests, please try again later.'),
});

/** Login/signup/password endpoints: tight, to slow down credential stuffing. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => sendError(res, 429, 'Too many attempts. Please wait a few minutes and try again.'),
});

/** Signup-request submission: prevent spam sign-ups. */
export const signupRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => sendError(res, 429, 'Too many signup attempts. Please try again later.'),
});

/** OTP send/verify/resend (signup email verification + forgot password): blunt brute-forcing a 4-digit code. */
export const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => sendError(res, 429, 'Too many attempts. Please wait a few minutes and try again.'),
});

/**
 * Phase 6.5: report generation is CPU/DB/memory-heavier per-request than
 * ordinary CRUD traffic (a full query + in-memory XLSX build, see
 * reports.service.ts), so it gets its own, much tighter budget instead of
 * riding on generalRateLimiter's 600/15min. Keyed by user, not just IP,
 * since admins share office IPs/VPNs in practice — see keyGenerator below.
 */
export const reportRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.authUser?.profileId ?? req.ip ?? 'unknown',
  handler: (_req, res) => sendError(res, 429, 'Too many report requests. Please wait a few minutes and try again.'),
});

/**
 * Phase 6.5/6.10: file uploads (task attachments, profile images) are
 * comparatively expensive (buffered in memory by multer, then written to
 * Supabase Storage) and are a natural target for repeated-upload abuse.
 * Scoped per-user for the same reason as reportRateLimiter above.
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.authUser?.profileId ?? req.ip ?? 'unknown',
  handler: (_req, res) => sendError(res, 429, 'Too many uploads. Please wait a few minutes and try again.'),
});
