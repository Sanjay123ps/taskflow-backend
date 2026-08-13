import { describe, expect, it, vi, beforeEach } from 'vitest';

const { findUnique, profileCount, profileCreate, requestUpdate, activityLogCreate, inviteUserByEmail, fakeClient } =
  vi.hoisted(() => {
    const findUnique = vi.fn();
    const profileCount = vi.fn();
    const profileCreate = vi.fn();
    const requestUpdate = vi.fn();
    const activityLogCreate = vi.fn().mockResolvedValue(undefined);
    const inviteUserByEmail = vi.fn();
    const fakeClient = {
      profile: { count: profileCount, create: profileCreate },
      adminCreationRequest: { findUnique, update: requestUpdate },
      activityLog: { create: activityLogCreate },
    };
    return { findUnique, profileCount, profileCreate, requestUpdate, activityLogCreate, inviteUserByEmail, fakeClient };
  });

// The service runs its approval logic inside `prisma.$transaction(cb)` — for
// these tests we just invoke the callback with the same fake client, which
// is enough to exercise the business logic without a real transaction.
vi.mock('../../src/config/prisma', () => ({
  prisma: {
    ...fakeClient,
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(fakeClient)),
  },
}));

vi.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { auth: { admin: { inviteUserByEmail } } },
  supabaseAnon: {},
}));

import { approveAdminRequest } from '../../src/modules/admin-requests/adminRequest.service';
import { ConflictError, ForbiddenError } from '../../src/utils/errors';

const PENDING_REQUEST = {
  id: 'req-1',
  requestedById: 'admin-1',
  fullName: 'New Admin',
  email: 'newadmin@example.com',
  status: 'PENDING',
  reviewedById: null,
  reviewedAt: null,
  rejectionReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  requestedBy: { id: 'admin-1', fullName: 'Requesting Admin' },
  reviewedBy: null,
};

beforeEach(() => {
  findUnique.mockReset();
  profileCount.mockReset();
  profileCreate.mockReset();
  requestUpdate.mockReset();
  activityLogCreate.mockClear();
  inviteUserByEmail.mockReset();
});

describe('approveAdminRequest', () => {
  it('rejects a request approved by the same admin who submitted it', async () => {
    findUnique.mockResolvedValue(PENDING_REQUEST);

    await expect(approveAdminRequest('req-1', 'admin-1')).rejects.toThrow(ForbiddenError);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(profileCreate).not.toHaveBeenCalled();
  });

  it('refuses to approve once 2 active admins already exist', async () => {
    findUnique.mockResolvedValue(PENDING_REQUEST);
    profileCount.mockResolvedValue(2); // cap already reached, checked inside the transaction

    await expect(approveAdminRequest('req-1', 'admin-2')).rejects.toThrow(ConflictError);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(profileCreate).not.toHaveBeenCalled();
  });

  it('approves normally when under the cap and reviewer is a different admin', async () => {
    findUnique.mockResolvedValue(PENDING_REQUEST);
    profileCount.mockResolvedValue(1); // under the cap of 2
    inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'auth-new-admin' } }, error: null });
    profileCreate.mockResolvedValue({ id: 'profile-new' });
    requestUpdate.mockResolvedValue({ ...PENDING_REQUEST, status: 'APPROVED' });

    const result = await approveAdminRequest('req-1', 'admin-2');

    expect(inviteUserByEmail).toHaveBeenCalledWith('newadmin@example.com');
    expect(profileCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN', status: 'ACTIVE' }) }),
    );
    expect(result.status).toBe('APPROVED');
  });

  it('rejects approving a request that has already been reviewed', async () => {
    findUnique.mockResolvedValue({ ...PENDING_REQUEST, status: 'APPROVED' });

    await expect(approveAdminRequest('req-1', 'admin-2')).rejects.toThrow(ConflictError);
  });
});
