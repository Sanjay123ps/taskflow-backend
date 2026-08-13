import { describe, expect, it, vi, beforeEach } from 'vitest';

const { findUnique, updateMany, update, findFirst, logActivityMock, createNotificationMock } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  update: vi.fn(),
  findFirst: vi.fn(),
  logActivityMock: vi.fn().mockResolvedValue(undefined),
  createNotificationMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/config/prisma', () => ({
  prisma: {
    task: { findUnique, updateMany, update },
    profile: { findFirst },
  },
}));

vi.mock('../../src/modules/activities/activity.service', () => ({
  logActivity: logActivityMock,
}));

vi.mock('../../src/modules/notifications/notifications.service', () => ({
  createNotification: createNotificationMock,
}));

import { getTask, updateTask } from '../../src/modules/tasks/tasks.service';
import { ForbiddenError, NotFoundError } from '../../src/utils/errors';
import type { AuthUser } from '../../src/types/authUser';

const STAFF_A: AuthUser = {
  profileId: 'staff-a',
  authUserId: 'auth-a',
  role: 'STAFF',
  status: 'ACTIVE',
  email: 'a@example.com',
  fullName: 'Staff A',
  presenceStatus: 'ONLINE',
  lastActiveAt: new Date('2026-08-01T09:00:00Z'),
};

const ADMIN: AuthUser = {
  profileId: 'admin-1',
  authUserId: 'auth-admin',
  role: 'ADMIN',
  status: 'ACTIVE',
  email: 'admin@example.com',
  fullName: 'Admin One',
  presenceStatus: 'OFFLINE',
  lastActiveAt: null,
};

const TASK_ASSIGNED_TO_A = {
  id: 'task-1',
  title: 'Do the thing',
  description: 'Details here',
  status: 'PENDING',
  priority: 'MEDIUM',
  assignedToId: 'staff-a',
  createdById: 'admin-1',
  dueDate: new Date('2026-08-01'),
  dueTime: '17:00',
  attachmentUrl: null,
  attachmentPath: null,
  notes: null,
  completedAt: null,
  createdAt: new Date('2026-07-01'),
  updatedAt: new Date('2026-07-01'),
};

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  findFirst.mockReset();
  logActivityMock.mockClear();
  createNotificationMock.mockClear();
});

describe('getTask — staff scoping', () => {
  it('lets a staff member view their own task', async () => {
    findUnique.mockResolvedValue({ ...TASK_ASSIGNED_TO_A, assignedTo: null, createdBy: {} });
    await expect(getTask('task-1', STAFF_A)).resolves.toBeTruthy();
  });

  it("blocks a staff member from viewing another staff member's task", async () => {
    findUnique.mockResolvedValue({ ...TASK_ASSIGNED_TO_A, assignedToId: 'staff-b', assignedTo: null, createdBy: {} });
    await expect(getTask('task-1', STAFF_A)).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError for a nonexistent task', async () => {
    findUnique.mockResolvedValue(null);
    await expect(getTask('missing', STAFF_A)).rejects.toThrow(NotFoundError);
  });

  it('lets an admin view any task regardless of assignment', async () => {
    findUnique.mockResolvedValue({ ...TASK_ASSIGNED_TO_A, assignedToId: 'staff-b', assignedTo: null, createdBy: {} });
    await expect(getTask('task-1', ADMIN)).resolves.toBeTruthy();
  });
});

describe('updateTask — staff field/transition restrictions', () => {
  it('blocks a staff member from updating fields other than status', async () => {
    findUnique.mockResolvedValue(TASK_ASSIGNED_TO_A);
    await expect(updateTask('task-1', { title: 'New title' }, STAFF_A)).rejects.toThrow(ForbiddenError);
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks a staff member from updating someone else's task at all", async () => {
    findUnique.mockResolvedValue({ ...TASK_ASSIGNED_TO_A, assignedToId: 'staff-b' });
    await expect(updateTask('task-1', { status: 'COMPLETED' }, STAFF_A)).rejects.toThrow(ForbiddenError);
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks an illegal status transition (COMPLETED has no valid next state)', async () => {
    findUnique.mockResolvedValue({ ...TASK_ASSIGNED_TO_A, status: 'COMPLETED' });
    await expect(updateTask('task-1', { status: 'PENDING' }, STAFF_A)).rejects.toThrow(ForbiddenError);
    expect(update).not.toHaveBeenCalled();
  });

  it('allows a staff member to move their own task from PENDING to IN_PROGRESS', async () => {
    findUnique.mockResolvedValue(TASK_ASSIGNED_TO_A);
    update.mockResolvedValue({ ...TASK_ASSIGNED_TO_A, status: 'IN_PROGRESS', assignedTo: null, createdBy: {} });

    await updateTask('task-1', { status: 'IN_PROGRESS' }, STAFF_A);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'IN_PROGRESS' }) }),
    );
  });

  it('lets an admin update any field on any task', async () => {
    findUnique.mockResolvedValue({ ...TASK_ASSIGNED_TO_A, assignedToId: 'staff-b' });
    update.mockResolvedValue({ ...TASK_ASSIGNED_TO_A, title: 'Retitled', assignedTo: null, createdBy: {} });

    await updateTask('task-1', { title: 'Retitled' }, ADMIN);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Retitled' }) }));
  });
});
