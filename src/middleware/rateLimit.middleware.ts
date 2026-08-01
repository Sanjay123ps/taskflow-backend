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
