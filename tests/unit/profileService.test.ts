import { describe, expect, it, vi, beforeEach } from 'vitest';

const { findUnique, findUniqueOrThrow, update } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../src/config/prisma', () => ({
  prisma: { profile: { findUnique, findUniqueOrThrow, update } },
}));

import { getMyStatus } from '../../src/modules/profile/profile.service';
import { ForbiddenError } from '../../src/utils/errors';
import type { AuthUser } from '../../src/types/authUser';

const STAFF: AuthUser = {
  profileId: 'staff-1',
  authUserId: 'auth-1',
  role: 'STAFF',
  status: 'ACTIVE',
  email: 's@example.com',
  fullName: 'Staffer',
  presenceStatus: 'BUSY',
  lastActiveAt: new Date(),
};

beforeEach(() => {
  findUnique.mockReset();
  findUniqueOrThrow.mockReset();
  update.mockReset();
});

describe('getMyStatus', () => {
  it('rejects non-STAFF callers without touching the database', async () => {
    const admin: AuthUser = { ...STAFF, role: 'ADMIN' };
    await expect(getMyStatus(admin)).rejects.toThrow(ForbiddenError);
    expect(findUnique).not.toHaveBeenCalled();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('returns presence straight from the already-authenticated session data — zero DB reads', async () => {
    const result = await getMyStatus(STAFF);
    expect(result.status).toBe('BUSY');
    expect(findUnique).not.toHaveBeenCalled();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('flips a stale (>20min inactive) non-OFFLINE presence to OFFLINE with exactly one write, no read', async () => {
    const staleUser: AuthUser = { ...STAFF, lastActiveAt: new Date(Date.now() - 30 * 60 * 1000) };
    update.mockResolvedValue({ id: 'staff-1', presenceStatus: 'OFFLINE', lastActiveAt: staleUser.lastActiveAt });

    const result = await getMyStatus(staleUser);

    expect(result.status).toBe('OFFLINE');
    expect(findUnique).not.toHaveBeenCalled();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { presenceStatus: 'OFFLINE' },
      select: { id: true, presenceStatus: true, lastActiveAt: true },
    });
  });

  it('does not re-write an already-OFFLINE presence, even if lastActiveAt is very old', async () => {
    const offlineUser: AuthUser = {
      ...STAFF,
      presenceStatus: 'OFFLINE',
      lastActiveAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    };
    const result = await getMyStatus(offlineUser);
    expect(result.status).toBe('OFFLINE');
    expect(update).not.toHaveBeenCalled();
  });
});
