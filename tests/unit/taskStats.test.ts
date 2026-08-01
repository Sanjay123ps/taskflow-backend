import { describe, expect, it, vi, beforeEach } from 'vitest';

const { groupBy } = vi.hoisted(() => ({ groupBy: vi.fn() }));

vi.mock('../../src/config/prisma', () => ({
  prisma: { task: { groupBy } },
}));

import { computeTaskStatsForStaff, computeTaskStatsForStaffIds } from '../../src/modules/tasks/task-stats.util';
import { toStaffMemberDTO } from '../../src/utils/dto';

beforeEach(() => {
  groupBy.mockReset();
});

describe('computeTaskStatsForStaffIds', () => {
  it('returns all-zero stats for staff with no tasks', async () => {
    groupBy.mockResolvedValue([]);
    const result = await computeTaskStatsForStaffIds(['staff-1']);
    expect(result.get('staff-1')).toEqual({ total: 0, completed: 0, pending: 0, overdue: 0 });
  });

  it('buckets IN_PROGRESS together with PENDING as "pending"', async () => {
    groupBy.mockResolvedValue([
      { assignedToId: 'staff-1', status: 'PENDING', _count: { _all: 2 } },
      { assignedToId: 'staff-1', status: 'IN_PROGRESS', _count: { _all: 3 } },
      { assignedToId: 'staff-1', status: 'COMPLETED', _count: { _all: 5 } },
      { assignedToId: 'staff-1', status: 'OVERDUE', _count: { _all: 1 } },
    ]);

    const result = await computeTaskStatsForStaffIds(['staff-1']);
    expect(result.get('staff-1')).toEqual({ total: 11, completed: 5, pending: 5, overdue: 1 });
  });

  it('short-circuits to an empty map for an empty id list (no query)', async () => {
    const result = await computeTaskStatsForStaffIds([]);
    expect(result.size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('computeTaskStatsForStaff unwraps the map for a single id', async () => {
    groupBy.mockResolvedValue([{ assignedToId: 'staff-9', status: 'COMPLETED', _count: { _all: 4 } }]);
    const stats = await computeTaskStatsForStaff('staff-9');
    expect(stats).toEqual({ total: 4, completed: 4, pending: 0, overdue: 0 });
  });
});

describe('toStaffMemberDTO completion rate', () => {
  const baseProfile = {
    id: 'p1',
    fullName: 'Jordan Lee',
    email: 'jordan@example.com',
    employeeId: 'EMP001',
    phone: null,
    department: null,
    designation: null,
    profileImageUrl: null,
    role: 'STAFF' as const,
    status: 'ACTIVE' as const,
    joiningDate: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    authUserId: 'auth-1',
  };

  it('rounds completion rate to the nearest percent', () => {
    const dto = toStaffMemberDTO(baseProfile as any, { total: 3, completed: 1, pending: 2, overdue: 0 });
    // 1/3 = 33.33...% -> rounds to 33
    expect(dto.taskStats?.completionRate).toBe(33);
  });

  it('reports 0% completion when there are no tasks, not NaN/division-by-zero', () => {
    const dto = toStaffMemberDTO(baseProfile as any, { total: 0, completed: 0, pending: 0, overdue: 0 });
    expect(dto.taskStats?.completionRate).toBe(0);
  });

  it('omits taskStats entirely when none is provided', () => {
    const dto = toStaffMemberDTO(baseProfile as any);
    expect(dto.taskStats).toBeUndefined();
  });
});
