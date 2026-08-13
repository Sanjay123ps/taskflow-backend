import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validation.middleware';
import { authRateLimiter, otpRateLimiter } from '../../middleware/rateLimit.middleware';
import {
  changePasswordHandler,
  forgotPasswordHandler,
  initialAdminSetupHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  resendPasswordResetOtpHandler,
  resetPasswordHandler,
  verifyPasswordResetOtpHandler,
} from './auth.controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  initialAdminSetupSchema,
  loginSchema,
  resendResetOtpSchema,
  resetPasswordSchema,
  verifyResetOtpSchema,
} from './auth.validation';

const router = Router();

router.post('/login', authRateLimiter, validate(loginSchema), loginHandler);
router.post('/refresh', authRateLimiter, refreshHandler);
router.post('/logout', authRateLimiter, logoutHandler);
router.post('/change-password', requireAuth, validate(changePasswordSchema), changePasswordHandler);
router.get('/me', requireAuth, meHandler);
router.post(
  '/setup-initial-admin',
  authRateLimiter,
  validate(initialAdminSetupSchema),
  initialAdminSetupHandler,
);

// Forgot Password flow — all public, all rate-limited against brute force.
router.post('/password/forgot', otpRateLimiter, validate(forgotPasswordSchema), forgotPasswordHandler);
router.post('/password/resend-otp', otpRateLimiter, validate(resendResetOtpSchema), resendPasswordResetOtpHandler);
router.post('/password/verify-otp', otpRateLimiter, validate(verifyResetOtpSchema), verifyPasswordResetOtpHandler);
router.post('/password/reset', otpRateLimiter, validate(resetPasswordSchema), resetPasswordHandler);

export default router;
