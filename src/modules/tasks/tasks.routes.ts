import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { uploadTaskAttachment } from '../../middleware/upload.middleware';
import {
  addCommentHandler,
  addTaskAttachmentHandler,
  createTaskHandler,
  deleteTaskHandler,
  getTaskHandler,
  listCommentsHandler,
  listTasksHandler,
  updateTaskHandler,
} from './tasks.controller';
import { addCommentSchema, createTaskSchema, taskIdParamSchema, taskQuerySchema, updateTaskSchema } from './tasks.validation';

const router = Router();

router.use(requireAuth);

router.get('/', validate(taskQuerySchema, 'query'), listTasksHandler);
router.get('/:id', validate(taskIdParamSchema, 'params'), getTaskHandler);
router.post('/', requireAdmin, uploadTaskAttachment, validate(createTaskSchema), createTaskHandler);
router.patch('/:id', validate(taskIdParamSchema, 'params'), validate(updateTaskSchema), updateTaskHandler);
router.post('/:id/attachment', validate(taskIdParamSchema, 'params'), uploadTaskAttachment, addTaskAttachmentHandler);
router.delete('/:id', requireAdmin, validate(taskIdParamSchema, 'params'), deleteTaskHandler);

router.get('/:id/comments', validate(taskIdParamSchema, 'params'), listCommentsHandler);
router.post('/:id/comments', validate(taskIdParamSchema, 'params'), validate(addCommentSchema), addCommentHandler);

export default router;
