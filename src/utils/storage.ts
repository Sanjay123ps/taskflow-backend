import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { BadRequestError } from './errors';
import { logger } from '../config/logger';

export interface UploadedFileMeta {
  path: string;
  publicUrl: string;
}

/**
 * Phase 5 hardening: task attachments used to be served via a permanent
 * public URL (`getPublicUrl`), stored once in `Task.attachmentUrl` and
 * handed out to anyone who could read that field. Since the bucket is
 * public, that URL works for literally anyone who obtains it — forever,
 * with no auth check at the storage layer — regardless of whether the API
 * itself correctly gates who can *see* the task. "Nobody knows the URL"
 * is not the same thing as "the URL is access-controlled", and per the
 * Phase 5 brief we can't treat those as equivalent.
 *
 * The fix: TASK_ATTACHMENTS_BUCKET must be switched to a PRIVATE Supabase
 * Storage bucket (see README "Storage buckets" section), and attachment
 * links are now short-lived *signed* URLs minted on demand by
 * `createSignedAttachmentUrl`, only after the request has already passed
 * the existing task-ownership check (`getTask` / `listTasks` in
 * tasks.service.ts already verify a STAFF caller owns the task before this
 * is ever called). `Task.attachmentUrl` is no longer written to the
 * database at all for new/updated attachments — only `attachmentPath` is
 * persisted, and a fresh signed URL is generated at read time every time.
 *
 * Profile images are deliberately NOT moved to this model — see
 * `uploadProfileImageFile` below for why.
 */
const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * Derives a safe file extension from a user-supplied filename. Only
 * alphanumeric extensions of reasonable length are trusted (matches the
 * shape of every real extension we expect: jpg, png, pdf, docx, ...);
 * anything else (no extension, an unexpectedly long "extension" from a
 * dotless filename, path separators, etc.) falls back to 'bin' rather than
 * being concatenated as-is into the Supabase Storage object path.
 */
function sanitizeExtension(originalName: string): string {
  const candidate = originalName.split('.').pop() ?? '';
  return /^[a-zA-Z0-9]{1,10}$/.test(candidate) ? candidate.toLowerCase() : 'bin';
}

/**
 * Uploads a buffer to the given Supabase Storage bucket under a
 * collision-free path, and returns its public URL. Buckets are expected to
 * be created (and, for private buckets, have signed-URL policies set) as
 * part of Supabase project setup — see README.
 */
export async function uploadToBucket(
  bucket: string,
  folder: string,
  file: Express.Multer.File,
): Promise<UploadedFileMeta> {
  const extension = sanitizeExtension(file.originalname);
  const path = `${folder}/${randomUUID()}.${extension}`;

  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });

  if (error) {
    throw new BadRequestError(`File upload failed: ${error.message}`);
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

export async function deleteFromBucket(bucket: string, path: string): Promise<void> {
  await supabaseAdmin.storage.from(bucket).remove([path]);
}

export function uploadTaskAttachmentFile(file: Express.Multer.File) {
  return uploadToBucket(env.TASK_ATTACHMENTS_BUCKET, 'tasks', file);
}

/**
 * Profile images stay on the public-bucket/permanent-URL model
 * intentionally, unlike task attachments:
 *  - They're rendered inline in dozens of places (task lists, staff
 *    directory, comments, notifications) across both frontends; forcing
 *    every one of those call sites through an async signed-URL fetch
 *    would be a much larger frontend change than this backend-only phase
 *    covers, for content that is, by design, an avatar meant to be seen.
 *  - They carry materially lower sensitivity than task attachments, which
 *    can be arbitrary internal documents (see ALLOWED_ATTACHMENT_MIME_TYPES
 *    in upload.middleware.ts — PDFs, Office docs, plain text).
 *  - Object names are still collision-free random UUIDs (sanitizeExtension
 *    above), so they aren't enumerable even though they're public.
 * If profile images ever need to carry sensitive content, this should be
 * revisited the same way task attachments were.
 */
export function uploadProfileImageFile(file: Express.Multer.File) {
  return uploadToBucket(env.PROFILE_IMAGES_BUCKET, 'profiles', file);
}

/**
 * Mints a short-lived signed URL for a task attachment. Returns null (never
 * throws) if the object is missing or Supabase Storage errors, so a broken
 * attachment reference degrades to "no attachment link" in API responses
 * rather than a 500 — callers (tasks.service.ts) treat null as "omit the
 * link" the same way they already treat a task with no attachment at all.
 */
export async function createSignedAttachmentUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(env.TASK_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    logger.warn({ err: error, path }, 'Failed to create signed URL for task attachment');
    return null;
  }

  return data.signedUrl;
}
