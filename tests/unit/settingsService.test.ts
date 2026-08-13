import { describe, expect, it, vi, beforeEach } from 'vitest';

const { findUniqueOrThrow, update, updateUserById, logActivityMock } = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  updateUserById: vi.fn().mockResolvedValue({ error: null }),
  logActivityMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/config/prisma', () => ({
  prisma: { profile: { findUniqueOrThrow, update } },
}));

vi.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { auth: { admin: { updateUserById } } },
}));

vi.mock('../../src/modules/activities/activity.service', () => ({
  logActivity: logActivityMock,
}));

import { updateAccountSettings } from '../../src/modules/settings/settings.service';
import type { AuthUser } from '../../src/types/authUser';

const AUTH_USER: AuthUser = {
  profileId: 'profile-1',
  authUserId: 'supabase-auth-1',
  role: 'STAFF',
  status: 'ACTIVE',
  email: 'old@example.com',
  fullName: 'Old Name',
  presenceStatus: 'ACTIVE',
  lastActiveAt: new Date(),
};

const UPDATED_PROFILE = {
  id: 'profile-1',
  fullName: 'New Name',
  email: 'old@example.com',
  role: 'STAFF' as const,
  status: 'ACTIVE' as const,
  authUserId: 'supabase-auth-1',
  employeeId: 'EMP001',
  phone: null,
  department: null,
  designation: null,
  profileImageUrl: null,
  joiningDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  findUniqueOrThrow.mockReset();
  update.mockReset().mockResolvedValue(UPDATED_PROFILE);
  updateUserById.mockReset().mockResolvedValue({ error: null });
  logActivityMock.mockClear();
});

describe('updateAccountSettings', () => {
  it('never re-fetches the profile it already has from the authenticated session', async () => {
    await updateAccountSettings({ name: 'New Name', email: 'old@example.com', phone: null }, AUTH_USER);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('only calls Supabase to sync email when the email actually changes', async () => {
    await updateAccountSettings({ name: 'New Name', email: 'old@example.com', phone: null }, AUTH_USER);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('syncs Supabase auth using authUser.authUserId (not a re-fetched value) when email changes', async () => {
    update.mockResolvedValue({ ...UPDATED_PROFILE, email: 'new@example.com' });
    await updateAccountSettings({ name: 'New Name', email: 'new@example.com', phone: null }, AUTH_USER);
    expect(updateUserById).toHaveBeenCalledWith('supabase-auth-1', { email: 'new@example.com' });
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('does not touch Postgres at all if the Supabase email sync fails', async () => {
    updateUserById.mockResolvedValue({ error: { message: 'email taken' } });
    await expect(
      updateAccountSettings({ name: 'New Name', email: 'taken@example.com', phone: null }, AUTH_USER),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
});
