import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { UnauthorizedError } from '../utils/errors';
import { verifyAccessToken } from '../utils/tokens';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Requires a valid, non-expired access token AND a matching profile that
 * still exists and is ACTIVE. This is the backend authorization gate — the
 * frontend's own route guards are UX only and are never trusted alone.
 */
export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) {
    throw new UnauthorizedError('You need to sign in to continue.');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }

  const profile = await prisma.profile.findUnique({ where: { id: payload.sub } });

  if (!profile) {
    throw new UnauthorizedError('Account not found.');
  }

  if (profile.status !== 'ACTIVE') {
    throw new UnauthorizedError(
      profile.status === 'PENDING'
        ? 'Your account is awaiting admin approval.'
        : 'Your account is not active. Contact an administrator.',
    );
  }

  req.authUser = {
    profileId: profile.id,
    authUserId: profile.authUserId,
    role: profile.role,
    status: profile.status,
    email: profile.email,
    fullName: profile.fullName,
  };

  // Keep presence's "last seen" honest for staff who are actively using
  // the portal without hitting the status endpoints directly, so the
  // inactivity-based auto-offline in profile.service.ts doesn't flip an
  // in-use account to OFFLINE. Throttled to at most once every 2 minutes
  // per request stream, and fire-and-forget so it never adds latency to
  // the request it piggybacks on.
  if (
    profile.role === 'STAFF' &&
    profile.presenceStatus !== 'OFFLINE' &&
    (!profile.lastActiveAt || Date.now() - profile.lastActiveAt.getTime() > 2 * 60 * 1000)
  ) {
    prisma.profile.update({ where: { id: profile.id }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
  }

  next();
});
