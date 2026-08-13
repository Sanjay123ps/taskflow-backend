import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import * as adminRequestService from './adminRequest.service';
import {
  adminRequestIdParamSchema,
  adminRequestQuerySchema,
  rejectAdminRequestSchema,
  submitAdminRequestSchema,
  type AdminRequestQueryInput,
  type SubmitAdminRequestInput,
} from './adminRequest.validation';

const submitHandler = asyncHandler(async (req: Request<unknown, unknown, SubmitAdminRequestInput>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const request = await adminRequestService.submitAdminRequest(req.body, req.authUser.profileId);
  sendCreated(res, request, 'Admin creation request submitted');
});

const listHandler = asyncHandler(
  async (req: Request<unknown, unknown, unknown, AdminRequestQueryInput>, res: Response) => {
    const result = await adminRequestService.listAdminRequests(req.query);
    sendSuccess(res, result);
  },
);

const approveHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const request = await adminRequestService.approveAdminRequest(req.params.id, req.authUser.profileId);
  sendSuccess(res, request, 'Admin request approved');
});

const rejectHandler = asyncHandler(
  async (req: Request<{ id: string }, unknown, { reason?: string }>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const request = await adminRequestService.rejectAdminRequest(req.params.id, req.authUser.profileId, req.body.reason);
    sendSuccess(res, request, 'Admin request rejected');
  },
);

const router = Router();
router.use(requireAuth, requireAdmin);

router.post('/', validate(submitAdminRequestSchema), submitHandler);
router.get('/', validate(adminRequestQuerySchema, 'query'), listHandler);
router.patch('/:id/approve', validate(adminRequestIdParamSchema, 'params'), approveHandler);
router.patch('/:id/reject', validate(adminRequestIdParamSchema, 'params'), validate(rejectAdminRequestSchema), rejectHandler);

export default router;
