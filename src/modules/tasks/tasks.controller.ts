import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import * as tasksService from './tasks.service';
import type { CreateTaskInput, TaskQueryInput, UpdateTaskInput } from './tasks.validation';

export const listTasksHandler = asyncHandler(async (req: Request<unknown, unknown, unknown, TaskQueryInput>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const result = await tasksService.listTasks(req.query, req.authUser);
  sendSuccess(res, result);
});

export const getTaskHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const task = await tasksService.getTask(req.params.id, req.authUser);
  sendSuccess(res, task);
});

export const createTaskHandler = asyncHandler(
  async (req: Request<unknown, unknown, CreateTaskInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const task = await tasksService.createTask(req.body, req.file, req.authUser.profileId);
    sendCreated(res, task, 'Task created');
  },
);

export const updateTaskHandler = asyncHandler(
  async (req: Request<{ id: string }, unknown, UpdateTaskInput>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const task = await tasksService.updateTask(req.params.id, req.body, req.authUser);
    sendSuccess(res, task, 'Task updated');
  },
);

export const addTaskAttachmentHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const task = await tasksService.addTaskAttachment(req.params.id, req.file, req.authUser);
  sendSuccess(res, task, 'Attachment uploaded');
});

export const deleteTaskHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  await tasksService.deleteTask(req.params.id, req.authUser.profileId);
  sendSuccess(res, null, 'Task deleted');
});

export const listCommentsHandler = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError();
  const comments = await tasksService.listComments(req.params.id, req.authUser);
  sendSuccess(res, comments);
});

export const addCommentHandler = asyncHandler(
  async (req: Request<{ id: string }, unknown, { message: string }>, res: Response) => {
    if (!req.authUser) throw new UnauthorizedError();
    const comment = await tasksService.addComment(req.params.id, req.body.message, req.authUser);
    sendCreated(res, comment, 'Comment added');
  },
);
