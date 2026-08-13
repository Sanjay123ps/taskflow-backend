import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { findUnique, update } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/config/prisma', () => ({
  prisma: { profile: { findUnique, update } },
}));

import { requireAuth } from '../../src/middleware/auth.middleware';
import { signAccessToken } from '../../src/utils/tokens';
import { UnauthorizedError } from '../../src/utils/errors';

function fakeReq(token?: string): Request {
  return { headers: { authorization: token ? `Bearer ${token}` : undefined } } as unknown as Request;
}

// requireAuth is wrapped by asyncHandler, which does `fn(...).catch(next)`
// without returning that promise — so the RequestHandler itself resolves
// synchronously and `await requireAuth(...)` only guarantees one
// microtask tick, which isn't always enough once a mocked `await
// prisma...` hop is in the chain. A macrotask flush guarantees every
// pending microtask (however many hops) has settled before we assert.
async function runMiddleware(req: Request, res: Response, next: ReturnType<typeof vi.fn>) {
  requireAuth(req, res, next);
  await new Promise((resolve) => setImmediate(resolve));
}

const BASE_PROFILE = {
  id: 'profile-1',
  authUserId: 'auth-1',
  role: 'STAFF' as const,
  status: 'ACTIVE' as const,
  email: 'staff@example.com',
  fullName: 'Staff Person',
  presenceStatus: 'ONLINE' as const,
  lastActiveAt: new Date(),
};

const validToken = () => signAccessToken({ sub: 'profile-1', authUserId: 'auth-1', role: 'STAFF' });

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset().mockResolvedValue(undefined);
});

describe('requireAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const req = fakeReq();
    const next = vi.fn();
    await runMiddleware(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a garbage/invalid token without hitting the database', async () => {
    const req = fakeReq('not-a-real-jwt');
    const next = vi.fn();
    await runMiddleware(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a valid token whose profile no longer exists', async () => {
    findUnique.mockResolvedValue(null);
    const req = fakeReq(validToken());
    const next = vi.fn();
    await runMiddleware(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('rejects a deactivated (INACTIVE) account even with a valid, unexpired token', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, status: 'INACTIVE' });
    const req = fakeReq(validToken());
    const next = vi.fn();
    await runMiddleware(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(req.authUser).toBeUndefined();
  });

  it('rejects a PENDING (not-yet-approved) account with a distinct message', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, status: 'PENDING' });
    const req = fakeReq(validToken());
    const next = vi.fn();
    await runMiddleware(req, {} as Response, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toMatch(/awaiting admin approval/i);
  });

  it('accepts a valid token for an ACTIVE staff account and populates req.authUser', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    const req = fakeReq(validToken());
    const next = vi.fn();
    await runMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.authUser).toEqual({
      profileId: 'profile-1',
      authUserId: 'auth-1',
      role: 'STAFF',
      status: 'ACTIVE',
      email: 'staff@example.com',
      fullName: 'Staff Person',
      presenceStatus: 'ONLINE',
      lastActiveAt: BASE_PROFILE.lastActiveAt,
    });
  });

  it('accepts an ADMIN account the same way (role is trusted from the DB row, not hardcoded)', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, role: 'ADMIN' });
    const req = fakeReq(validToken());
    const next = vi.fn();
    await runMiddleware(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.authUser?.role).toBe('ADMIN');
  });

  it('performs exactly one DB read per request, selecting only the columns it needs', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    const req = fakeReq(validToken());
    await runMiddleware(req, {} as Response, vi.fn());

    expect(findUnique).toHaveBeenCalledTimes(1);
    const call = findUnique.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'profile-1' });
    expect(call.select).toEqual({
      id: true,
      authUserId: true,
      role: true,
      status: true,
      email: true,
      fullName: true,
      presenceStatus: true,
      lastActiveAt: true,
    });
  });

  it('throttles the presence heartbeat write: does not write again inside the 2-minute window', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, lastActiveAt: new Date() });
    const req = fakeReq(validToken());
    await runMiddleware(req, {} as Response, vi.fn());
    // Fire-and-forget write is not awaited by the middleware; give the
    // microtask queue a tick to let the .catch/.then chain settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
  });

  it('fires the presence heartbeat write when lastActiveAt is stale (>2 minutes)', async () => {
    const staleTime = new Date(Date.now() - 5 * 60 * 1000);
    findUnique.mockResolvedValue({ ...BASE_PROFILE, lastActiveAt: staleTime });
    const req = fakeReq(validToken());
    await runMiddleware(req, {} as Response, vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'profile-1' }, data: { lastActiveAt: expect.any(Date) } }),
    );
  });

  it('never fires the heartbeat write for an ADMIN account (presence is a STAFF-only concept)', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, role: 'ADMIN', lastActiveAt: null });
    const req = fakeReq(validToken());
    await runMiddleware(req, {} as Response, vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
  });
});
