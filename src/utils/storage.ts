import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { BadRequestError } from './errors';

export interface UploadedFileMeta {
  path: string;
  publicUrl: string;
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
  const extension = file.originalname.split('.').pop() ?? 'bin';
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
