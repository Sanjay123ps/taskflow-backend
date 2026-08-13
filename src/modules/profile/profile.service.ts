import type { PresenceStatus, Profile } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { toAdminProfileDTO, toPresenceStatusDTO, toStaffMemberDTO } from '../../utils/dto';
import { logActivity } from '../activities/activity.service';
import { deleteFromBucket, uploadProfileImageFile } from '../../utils/storage';
import { BadRequestError, ForbiddenError } from '../../utils/errors';
import type { AuthUser } from '../../types/authUser';
import type { UpdateStatusInput } from './profile.validation';

function toProfileDTO(profile: Profile) {
  return profile.role === 'ADMIN' ? toAdminProfileDTO(profile) : toStaffMemberDTO(profile);
}

/**
 * Supabase's public-URL format is
 * `.../storage/v1/object/public/{bucket}/{path}` — we only ever store the
 * full public URL on Profile, so to delete an old photo we recover its
 * storage path by slicing everything after the bucket segment.
 */
function extractStoragePath(publicUrl: string): string | null {
  const marker = `/public/${env.PROFILE_IMAGES_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;
  return publicUrl.slice(index + marker.length);
}

async function deleteOldPhotoIfAny(url: string | null): Promise<void> {
  if (!url) return;
  const path = extractStoragePath(url);
  if (!path) return;
  // Best-effort: a failed cleanup of the old file should never block the
  // response — the new photo is already saved and the DB already points
  // to it.
  await deleteFromBucket(env.PROFILE_IMAGES_BUCKET, path).catch(() => undefined);
}

/**
 * Uploads a new profile photo for the signed-in user (Admin or Staff —
 * each manages only their own). MIME type and the 5MB size limit are
 * already enforced by the `uploadProfileImage` multer middleware before
 * this ever runs. The old photo, if any, is only deleted *after* the new
 * one is confirmed uploaded and saved, per spec.
 */
export async function uploadProfilePhoto(authUser: AuthUser, file: Express.Multer.File | undefined) {
  if (!file) {
    throw new BadRequestError('Please upload a JPG, PNG, or WEBP image.');
  }

  const existing = await prisma.profile.findUniqueOrThrow({ where: { id: authUser.profileId } });
  const wasReplacing = Boolean(existing.profileImageUrl);

  const { publicUrl } = await uploadProfileImageFile(file);

  const updated = await prisma.profile.update({
    where: { id: authUser.profileId },
    data: { profileImageUrl: publicUrl },
  });

  await deleteOldPhotoIfAny(existing.profileImageUrl);

  await logActivity({
    userId: authUser.profileId,
    action: 'PROFILE_UPDATED',
    description: `${updated.fullName} ${wasReplacing ? 'updated' : 'uploaded'} their profile photo`,
    entityType: 'Profile',
    entityId: updated.id,
  });

  return toProfileDTO(updated);
}

// A staff member who hasn't been seen (see requireAuth's heartbeat) in
// this long is auto-flipped to OFFLINE the next time their status is
// read — mirrors the lazy-sync pattern used for stale INCOMPLETE
// attendance rows in attendance.service.ts, so no cron job is needed.
const INACTIVITY_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

interface PresenceSnapshot {
  id: string;
  presenceStatus: PresenceStatus;
  lastActiveAt: Date | null;
}

async function syncStalePresence<T extends PresenceSnapshot>(profile: T): Promise<T | PresenceSnapshot> {
  if (profile.presenceStatus === 'OFFLINE') return profile;

  const isStale = !profile.lastActiveAt || Date.now() - profile.lastActiveAt.getTime() > INACTIVITY_THRESHOLD_MS;
  if (!isStale) return profile;

  return prisma.profile.update({
    where: { id: profile.id },
    data: { presenceStatus: 'OFFLINE' },
    select: { id: true, presenceStatus: true, lastActiveAt: true },
  });
}

/**
 * GET /profile/status — always derives the target from the authenticated
 * session, never from a frontend-supplied id.
 *
 * requireAuth already loaded this exact profile row (including
 * presenceStatus/lastActiveAt) a moment ago for this same request, so we
 * reuse that instead of issuing a second, otherwise-identical
 * `profile.findUnique` by id — this endpoint now does zero DB reads in the
 * common case (only a write when the lazy OFFLINE-sync actually fires).
 */
export async function getMyStatus(authUser: AuthUser) {
  if (authUser.role !== 'STAFF') {
    throw new ForbiddenError('Only staff accounts have a presence status.');
  }
  const synced = await syncStalePresence({
    id: authUser.profileId,
    presenceStatus: authUser.presenceStatus,
    lastActiveAt: authUser.lastActiveAt,
  });
  return toPresenceStatusDTO(synced);
}

/**
 * PATCH /profile/status — a staff member can only ever set their own
 * status, and only to ACTIVE or BUSY (enforced by updateStatusSchema);
 * OFFLINE is exclusively backend-driven (logout / inactivity).
 */
export async function updateMyStatus(authUser: AuthUser, input: UpdateStatusInput) {
  if (authUser.role !== 'STAFF') {
    throw new ForbiddenError('Only staff accounts have a presence status.');
  }

  const updated = await prisma.profile.update({
    where: { id: authUser.profileId },
    data: { presenceStatus: input.status, lastActiveAt: new Date() },
  });

  return toPresenceStatusDTO(updated);
}

export async function removeProfilePhoto(authUser: AuthUser) {
  const existing = await prisma.profile.findUniqueOrThrow({ where: { id: authUser.profileId } });
  if (!existing.profileImageUrl) {
    return toProfileDTO(existing);
  }

  const updated = await prisma.profile.update({
    where: { id: authUser.profileId },
    data: { profileImageUrl: null },
  });

  await deleteOldPhotoIfAny(existing.profileImageUrl);

  await logActivity({
    userId: authUser.profileId,
    action: 'PROFILE_UPDATED',
    description: `${updated.fullName} removed their profile photo`,
    entityType: 'Profile',
    entityId: updated.id,
  });

  return toProfileDTO(updated);
}
