import { describe, expect, it, vi, beforeEach } from 'vitest';

const { taskGroupBy, taskFindMany, profileFindMany, activityFindMany } = vi.hoisted(() => ({
  taskGroupBy: vi.fn(),
  taskFindMany: vi.fn(),
  profileFindMany: vi.fn(),
  activityFindMany: vi.fn(),
}));

vi.mock('../../src/config/prisma', () => ({
  prisma: {
    task: { groupBy: taskGroupBy, findMany: taskFindMany, updateMany: vi.fn() },
    profile: { findMany: profileFindMany },
    activityLog: { findMany: activityFindMany },
  },
}));

vi.mock('../../src/modules/tasks/task-stats.util', () => ({
  computeTaskStatsForStaffIds: vi.fn().mockResolvedValue(new Map()),
}));

import { getAdminDashboardSummary, getStaffDashboardSummary } from '../../src/modules/dashboard/dashboard.service';
import type { AuthUser } from '../../src/types/authUser';

const STAFF: AuthUser = {
  profileId: 'staff-1',
  authUserId: 'auth-1',
  role: 'STAFF',
  status: 'ACTIVE',
  email: 's@example.com',
  fullName: 'Staffer',
  presenceStatus: 'ONLINE',
  lastActiveAt: new Date(),
};

beforeEach(() => {
  taskGroupBy.mockReset();
  taskFindMany.mockReset().mockResolvedValue([]);
  profileFindMany.mockReset().mockResolvedValue([]);
  activityFindMany.mockReset().mockResolvedValue([]);
});

describe('getAdminDashboardSummary', () => {
  it('performs no write query (the old GET-performs-UPDATE pattern is gone)', async () => {
    taskGroupBy.mockResolvedValue([]);
    const { prisma } = await import('../../src/config/prisma');
    await getAdminDashboardSummary({ range: 'week' });
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it('derives totalTasks/pendingTasks/completedTasks from a single groupBy call', async () => {
    taskGroupBy.mockResolvedValue([
      { status: 'PENDING', _count: { _all: 4 } },
      { status: 'IN_PROGRESS', _count: { _all: 2 } },
      { status: 'COMPLETED', _count: { _all: 10 } },
      { status: 'OVERDUE', _count: { _all: 1 } },
    ]);
    const result = await getAdminDashboardSummary({ range: 'week' });

    expect(taskGroupBy).toHaveBeenCalledTimes(1);
    // pendingTasks must mean status === 'PENDING' only, matching the
    // original behavior — IN_PROGRESS must NOT be folded in here.
    expect(result.kpis).toEqual({ totalTasks: 17, pendingTasks: 4, completedTasks: 10, completionRate: 59 });
  });

  it('computes taskCounters as the exact sum of the analytics buckets, with zero extra queries', async () => {
    taskGroupBy.mockResolvedValue([]);
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    taskFindMany.mockResolvedValue([
      { createdAt: now, completedAt: null, status: 'PENDING' },
      { createdAt: yesterday, completedAt: now, status: 'COMPLETED' },
      { createdAt: yesterday, completedAt: null, status: 'OVERDUE' },
    ]);

    const result = await getAdminDashboardSummary({ range: 'week' });

    const summed = result.analytics.reduce(
      (acc, b) => ({
        created: acc.created + b.created,
        completed: acc.completed + b.completed,
        pending: acc.pending + b.pending,
        overdue: acc.overdue + b.overdue,
      }),
      { created: 0, completed: 0, pending: 0, overdue: 0 },
    );
    expect(result.taskCounters).toEqual(summed);
    // Only one findMany for the whole analytics window, no per-bucket
    // count() calls (the 'week' range has 7 buckets — before this
    // change that would have meant up to 28 count() queries here).
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });

  it('issues exactly 4 queries total for the whole admin dashboard load (groupBy, staff, activity, analytics)', async () => {
    taskGroupBy.mockResolvedValue([]);
    await getAdminDashboardSummary({ range: 'today' });
    expect(taskGroupBy).toHaveBeenCalledTimes(1);
    expect(profileFindMany).toHaveBeenCalledTimes(1);
    expect(activityFindMany).toHaveBeenCalledTimes(1);
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });
});

describe('getStaffDashboardSummary', () => {
  it('performs no write query and scopes the groupBy to the calling staff member', async () => {
    taskGroupBy.mockResolvedValue([]);
    const { prisma } = await import('../../src/config/prisma');
    await getStaffDashboardSummary(STAFF);
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(taskGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assignedToId: 'staff-1' } }),
    );
  });

  it('keeps pendingTasks as PENDING-only, NOT folding in IN_PROGRESS (matches pre-existing behavior)', async () => {
    taskGroupBy.mockResolvedValue([
      { status: 'PENDING', _count: { _all: 3 } },
      { status: 'IN_PROGRESS', _count: { _all: 5 } },
      { status: 'COMPLETED', _count: { _all: 2 } },
      { status: 'OVERDUE', _count: { _all: 1 } },
    ]);
    const result = await getStaffDashboardSummary(STAFF);
    // totalTasks includes IN_PROGRESS; pendingTasks does not.
    expect(result.kpis).toEqual({
      totalTasks: 11,
      pendingTasks: 3,
      completedTasks: 2,
      overdueTasks: 1,
      completionRate: 18,
    });
  });

  it('reports 0% completion rate (not NaN) when the staff member has no tasks at all', async () => {
    taskGroupBy.mockResolvedValue([]);
    const result = await getStaffDashboardSummary(STAFF);
    expect(result.kpis.completionRate).toBe(0);
  });
});
