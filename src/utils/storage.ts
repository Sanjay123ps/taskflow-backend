import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { BadRequestError } from './errors';

export interface UploadedFileMeta {
  path: string;
  publicUrl: string;
}

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

export function uploadProfileImageFile(file: Express.Multer.File) {
  return uploadToBucket(env.PROFILE_IMAGES_BUCKET, 'profiles', file);
}
