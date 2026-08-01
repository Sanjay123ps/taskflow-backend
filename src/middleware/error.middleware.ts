import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../utils/errors';
import { sendError } from '../utils/apiResponse';
import { logger } from '../config/logger';
import { isProd } from '../config/env';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function notFoundHandler(req: Request, res: Response, _next: NextFunction) {
  sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error({ err, path: req.originalUrl }, 'Unhandled application error');
    }
    sendError(res, err.status, err.message, err.errors);
    return;
  }

  if (err instanceof ZodError) {
    const errors = err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
    sendError(res, 422, 'Please check the form and try again.', errors);
    return;
  }

  if (err instanceof multer.MulterError) {
    sendError(res, 400, `Upload error: ${err.message}`);
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta?.target.join(', ') : 'field';
      sendError(res, 409, `A record with this ${target} already exists.`);
      return;
    }
    if (err.code === 'P2025') {
      sendError(res, 404, 'That resource could not be found.');
      return;
    }
    logger.error({ err, path: req.originalUrl }, 'Prisma known request error');
    sendError(res, 500, 'Something went wrong on our end. Please try again shortly.');
    return;
  }

  logger.error({ err, path: req.originalUrl }, 'Unexpected error');
  sendError(
    res,
    500,
    'Something went wrong on our end. Please try again shortly.',
    isProd ? undefined : [{ message: err instanceof Error ? err.message : String(err) }],
  );
}
