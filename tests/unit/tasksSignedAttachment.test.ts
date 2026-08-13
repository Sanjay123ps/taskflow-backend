import { describe, expect, it, vi, beforeEach } from 'vitest';

const { findUnique, createSignedAttachmentUrl } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createSignedAttachmentUrl: vi.fn(),
}));

vi.mock('../../src/config/prisma', () => ({
  prisma: { task: { findUnique } },
}));

vi.mock('../../src/utils/storage', () => ({
  createSignedAttachmentUrl,
  uploadTaskAttachmentFile: vi.fn(),
  deleteFromBucket: vi.fn(),
}));

import { getTask } from '../../src/modules/tasks/tasks.service';
import { ForbiddenError } from '../../src/utils/errors';
import type { AuthUser } from '../../src/types/authUser';

const STAFF_A: AuthUser = {
  profileId: 'staff-a',
  authUserId: 'auth-a',
  role: 'STAFF',
  status: 'ACTIVE',
  email: 'a@example.com',
  fullName: 'Staff A',
  presenceStatus: 'ONLINE',
  lastActiveAt: null,
};

const TASK_WITH_ATTACHMENT = {
  id: 'task-1',
  title: 'Do the thing',
  description: 'Details',
  status: 'PENDING',
  priority: 'MEDIUM',
  assignedToId: 'staff-a',
  createdById: 'admin-1',
  dueDate: new Date('2026-08-01'),
  dueTime: '17:00',
  attachmentUrl: null, // never persisted anymore — see storage.ts
  attachmentPath: 'tasks/some-uuid.pdf',
  notes: null,
  completedAt: null,
  createdAt: new Date('2026-07-01'),
  updatedAt: new Date('2026-07-01'),
  assignedTo: null,
};

beforeEach(() => {
  findUnique.mockReset();
  createSignedAttachmentUrl.mockReset();
});

describe('getTask — Phase 5 signed attachment URL resolution', () => {
  it('resolves attachmentUrl to a freshly-minted signed URL for an authorized viewer', async () => {
    findUnique.mockResolvedValue(TASK_WITH_ATTACHMENT);
    createSignedAttachmentUrl.mockResolvedValue('https://signed.example/tasks/some-uuid.pdf?token=xyz');

    const dto = await getTask('task-1', STAFF_A);

    expect(createSignedAttachmentUrl).toHaveBeenCalledWith('tasks/some-uuid.pdf');
    expect(dto.attachmentUrl).toBe('https://signed.example/tasks/some-uuid.pdf?token=xyz');
  });

  it('never calls the storage layer for a task the caller is not authorized to view', async () => {
    findUnique.mockResolvedValue({ ...TASK_WITH_ATTACHMENT, assignedToId: 'staff-b' });

    await expect(getTask('task-1', STAFF_A)).rejects.toThrow(ForbiddenError);
    expect(createSignedAttachmentUrl).not.toHaveBeenCalled();
  });

  it('returns null attachmentUrl (no crash) for a task with no attachment', async () => {
    findUnique.mockResolvedValue({ ...TASK_WITH_ATTACHMENT, attachmentPath: null });
    createSignedAttachmentUrl.mockResolvedValue(null);

    const dto = await getTask('task-1', STAFF_A);
    expect(dto.attachmentUrl).toBeNull();
  });
});
