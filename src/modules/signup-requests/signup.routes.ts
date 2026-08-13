import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { signupRateLimiter, otpRateLimiter } from '../../middleware/rateLimit.middleware';
import {
  approveSignupRequestHandler,
  getSignupRequestHandler,
  listSignupRequestsHandler,
  rejectSignupRequestHandler,
  resendSignupOtpHandler,
  submitSignupRequestHandler,
  verifySignupOtpHandler,
} from './signup.controller';
import {
  rejectSignupRequestSchema,
  resendSignupOtpSchema,
  signupIdParamSchema,
  signupQuerySchema,
  submitSignupRequestSchema,
  verifySignupOtpSchema,
} from './signup.validation';

const router = Router();

// Public: anyone can submit a signup request.
router.post('/', signupRateLimiter, validate(submitSignupRequestSchema), submitSignupRequestHandler);

// Public: Staff Signup OTP verification (email confirmation) step.
router.post('/verify-otp', otpRateLimiter, validate(verifySignupOtpSchema), verifySignupOtpHandler);
router.post('/resend-otp', otpRateLimiter, validate(resendSignupOtpSchema), resendSignupOtpHandler);

// Admin-only: reviewing requests.
router.get('/', requireAuth, requireAdmin, validate(signupQuerySchema, 'query'), listSignupRequestsHandler);
router.get('/:id', requireAuth, requireAdmin, validate(signupIdParamSchema, 'params'), getSignupRequestHandler);
router.patch(
  '/:id/approve',
  requireAuth,
  requireAdmin,
  validate(signupIdParamSchema, 'params'),
  approveSignupRequestHandler,
);
router.patch(
  '/:id/reject',
  requireAuth,
  requireAdmin,
  validate(signupIdParamSchema, 'params'),
  validate(rejectSignupRequestSchema),
  rejectSignupRequestHandler,
);

export default router;
