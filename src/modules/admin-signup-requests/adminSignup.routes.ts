import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { authRateLimiter, signupRateLimiter } from '../../middleware/rateLimit.middleware';
import {
  approveAdminSignupRequestHandler,
  getAdminSignupRequestHandler,
  listAdminSignupRequestsHandler,
  rejectAdminSignupRequestHandler,
  resendAdminSignupOtpHandler,
  submitAdminSignupHandler,
  verifyAdminSignupOtpHandler,
} from './adminSignup.controller';
import {
  adminSignupEmailSchema,
  adminSignupIdParamSchema,
  adminSignupQuerySchema,
  rejectAdminSignupSchema,
  submitAdminSignupSchema,
  verifyAdminSignupOtpSchema,
} from './adminSignup.validation';

const router = Router();

// Public: anyone can start an admin signup. Verifying the OTP proves they
// control the inbox — it does not grant access. See adminSignup.service.ts.
router.post('/', signupRateLimiter, validate(submitAdminSignupSchema), submitAdminSignupHandler);
router.post(
  '/resend-otp',
  signupRateLimiter,
  validate(adminSignupEmailSchema),
  resendAdminSignupOtpHandler,
);
router.post(
  '/verify-otp',
  authRateLimiter,
  validate(verifyAdminSignupOtpSchema),
  verifyAdminSignupOtpHandler,
);

// Admin-only: reviewing requests.
router.get('/', requireAuth, requireAdmin, validate(adminSignupQuerySchema, 'query'), listAdminSignupRequestsHandler);
router.get(
  '/:id',
  requireAuth,
  requireAdmin,
  validate(adminSignupIdParamSchema, 'params'),
  getAdminSignupRequestHandler,
);
router.patch(
  '/:id/approve',
  requireAuth,
  requireAdmin,
  validate(adminSignupIdParamSchema, 'params'),
  approveAdminSignupRequestHandler,
);
router.patch(
  '/:id/reject',
  requireAuth,
  requireAdmin,
  validate(adminSignupIdParamSchema, 'params'),
  validate(rejectAdminSignupSchema),
  rejectAdminSignupRequestHandler,
);

export default router;
