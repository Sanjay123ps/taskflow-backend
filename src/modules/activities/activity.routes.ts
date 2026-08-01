import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { listActivity } from './activity.service';
import { activityQuerySchema, type ActivityQueryInput } from './activity.validation';

const listActivityHandler = asyncHandler(
  async (req: Request<unknown, unknown, unknown, ActivityQueryInput>, res: Response) => {
    const result = await listActivity(req.query);
    sendSuccess(res, result);
  },
);

const router = Router();
router.use(requireAuth, requireAdmin);
router.get('/', validate(activityQuerySchema, 'query'), listActivityHandler);

export default router;
