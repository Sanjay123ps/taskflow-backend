import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import {
  createStaffHandler,
  getStaffHandler,
  listStaffHandler,
  resetStaffPasswordHandler,
  updateStaffHandler,
} from './staff.controller';
import { createStaffSchema, staffIdParamSchema, staffQuerySchema, updateStaffSchema } from './staff.validation';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/', validate(staffQuerySchema, 'query'), listStaffHandler);
router.get('/:id', validate(staffIdParamSchema, 'params'), getStaffHandler);
router.post('/', validate(createStaffSchema), createStaffHandler);
router.patch('/:id', validate(staffIdParamSchema, 'params'), validate(updateStaffSchema), updateStaffHandler);
router.post('/:id/reset-password', validate(staffIdParamSchema, 'params'), resetStaffPasswordHandler);

export default router;
