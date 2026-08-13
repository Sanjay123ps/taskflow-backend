import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { UnauthorizedError } from '../utils/errors';
import { verifyAccessToken } from '../utils/tokens';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Requires a valid, non-expired access token AND a matching profile that
 * still exists and is ACTIVE. This is the backend authorization gate — the
 * frontend's own route guards are UX only and are never trusted alone.
 *
 * Scalability note (Phase 1 audit): this still does exactly one
 * `profile.findUnique` per request, and that is intentional, not an
 * oversight:
 *
 *  - `profileId` (JWT `sub`) and `role` are already inside the signed
 *    access token, so they don't need a DB round trip to be trusted — role
 *    is set once at account creation and is never changed anywhere in this
 *    codebase, so there's no "stale role" risk to worry about either way.
 *  - `status` (ACTIVE/INACTIVE/SUSPENDED) is the one thing that genuinely
 *    can't come from the token: deactivating a staff member (see
 *    staff.service.ts `updateStaff`) revokes their sessions immediately,
 *    and login/refresh both re-check status too — the whole point is that
 *    a disabled account stops working right away, not up to
 *    JWT_ACCESS_EXPIRES_IN (15m default) later. That requires a fresh read
 *    on every request.
 *  - The lookup is a single indexed primary-key read (no joins, no scan),
 *    which is already about as cheap as a DB round trip gets — it is not
 *    the bottleneck it might look like. Caching it would be the obvious
 *    next move, but an in-process cache would (a) go stale across
 *    multiple backend instances and (b) reintroduce exactly the
 *    "deactivated user can still act" window this check exists to close.
 *    Redis is explicitly out of scope for this phase, so the correct call
 *    right now is: don't cache this yet. If profile lookups do become a
 *    measured bottleneck, a shared cache with invalidation on
 *    status/role change (on `updateStaff`, `resetStaffPassword`, etc.) is
 *    the right follow-up — that's a Phase 4 concern, not this one.
 *
 * What *is* trimmed here is the column list: only the fields this
 * middleware or its immediate callers actually use are selected, instead
 * of the full Profile row (department, designation, joiningDate, etc.).
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

  const profile = await prisma.profile.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      authUserId: true,
      role: true,
      status: true,
      email: true,
      fullName: true,
      presenceStatus: true,
      lastActiveAt: true,
    },
  });

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
    presenceStatus: profile.presenceStatus,
    lastActiveAt: profile.lastActiveAt,
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
