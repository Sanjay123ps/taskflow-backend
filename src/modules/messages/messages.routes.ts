import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validation.middleware';
import * as messagesService from './messages.service';
import {
  sendMessageSchema,
  threadParamSchema,
  threadQuerySchema,
  type SendMessageInput,
  type ThreadQueryInput,
} from './messages.validation';

const sendHandler = asyncHandler(async (req: Request<unknown, unknown, SendMessageInput>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const message = await messagesService.sendMessage(req.body, req.authUser);
  sendCreated(res, message, 'Message sent');
});

const conversationsHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const conversations = await messagesService.listConversations(req.authUser);
  sendSuccess(res, conversations);
});

const threadHandler = asyncHandler(
  async (req: Request<{ userId: string }, unknown, unknown, ThreadQueryInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const thread = await messagesService.getThread(req.params.userId, req.authUser, req.query);
    sendSuccess(res, thread);
  },
);

const router = Router();
router.use(requireAuth);

router.get('/conversations', conversationsHandler);
router.get('/thread/:userId', validate(threadParamSchema, 'params'), validate(threadQuerySchema, 'query'), threadHandler);
router.post('/', validate(sendMessageSchema), sendHandler);

export default router;
