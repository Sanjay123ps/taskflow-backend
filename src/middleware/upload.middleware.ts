import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { BadRequestError } from '../utils/errors';
import { matchesDeclaredMimeType } from '../utils/fileSignature';

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const storage = multer.memoryStorage();

export const uploadTaskAttachment = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      cb(new BadRequestError(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
}).single('attachment');

export const uploadProfileImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(new BadRequestError(`Unsupported image type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
}).single('profileImage');

/**
 * Phase 6.10/Phase 5 hardening: `fileFilter` above only checks the
 * *declared* multipart Content-Type, which the caller sets and multer
 * never verifies against the actual bytes. Run this immediately after
 * `uploadTaskAttachment` / `uploadProfileImage` in the route chain (once
 * `req.file.buffer` is populated) to reject payloads whose content doesn't
 * match what they claim to be — e.g. an HTML/SVG file renamed to `.png`
 * with a spoofed `Content-Type: image/png`.
 */
export function validateFileSignature(req: Request, _res: Response, next: NextFunction) {
  if (!req.file) {
    next();
    return;
  }
  if (!matchesDeclaredMimeType(req.file.buffer, req.file.mimetype)) {
    next(new BadRequestError(`The uploaded file's content doesn't match its declared type (${req.file.mimetype}).`));
    return;
  }
  next();
}
