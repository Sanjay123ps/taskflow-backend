import type { Response } from 'express';

export interface ApiErrorItem {
  field?: string;
  message: string;
}

export function sendSuccess<T>(res: Response, data: T, message = 'Success', status = 200): Response {
  return res.status(status).json({ success: true, data, message });
}

export function sendCreated<T>(res: Response, data: T, message = 'Created'): Response {
  return sendSuccess(res, data, message, 201);
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  errors?: ApiErrorItem[],
): Response {
  return res.status(status).json({ success: false, message, errors });
}
