import { describe, expect, it, vi } from 'vitest';

const { findManyTask, findManyProfile, findManyActivityLog, groupBy } = vi.hoisted(() => ({
  findManyTask: vi.fn(),
  findManyProfile: vi.fn(),
  findManyActivityLog: vi.fn(),
  groupBy: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/config/prisma', () => ({
  prisma: {
    task: { findMany: findManyTask, groupBy },
    profile: { findMany: findManyProfile },
    activityLog: { findMany: findManyActivityLog },
  },
}));

import { buildActivityReport, buildStaffReport, buildTasksReport } from '../../src/modules/reports/reports.service';

// REPORT_ROW_CAP in reports.service.ts — kept in sync manually since the
// constant isn't exported (it's an internal implementation detail of the
// service, not part of its public contract).
const REPORT_ROW_CAP = 5000;

function makeTasks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i}`,
    title: `Task ${i}`,
    assignedTo: { fullName: 'Staff', employeeId: 'E1' },
    createdBy: { fullName: 'Admin' },
    priority: 'MEDIUM',
    status: 'PENDING',
    dueDate: new Date('2026-01-01'),
    dueTime: '09:00',
    completedAt: null,
  }));
}

describe('buildTasksReport — Phase 4 row cap (unbounded-memory fix)', () => {
  it('passes REPORT_ROW_CAP as `take` to the query, so the DB never returns more than that many rows', async () => {
    findManyTask.mockResolvedValueOnce(makeTasks(3));
    await buildTasksReport({ format: 'xlsx' } as never);
    expect(findManyTask).toHaveBeenCalledWith(expect.objectContaining({ take: REPORT_ROW_CAP }));
  });

  it('sets truncated: true when the result hits the cap exactly', async () => {
    findManyTask.mockResolvedValueOnce(makeTasks(REPORT_ROW_CAP));
    const report = await buildTasksReport({ format: 'xlsx' } as never);
    expect(report.truncated).toBe(true);
  });

  it('sets truncated: false when the result is under the cap', async () => {
    findManyTask.mockResolvedValueOnce(makeTasks(2));
    const report = await buildTasksReport({ format: 'xlsx' } as never);
    expect(report.truncated).toBe(false);
    expect(report.rows).toHaveLength(2);
  });
});

describe('buildStaffReport — defensive row cap', () => {
  it('passes REPORT_ROW_CAP as `take` to the query', async () => {
    findManyProfile.mockResolvedValueOnce([]);
    await buildStaffReport({ format: 'xlsx' } as never);
    expect(findManyProfile).toHaveBeenCalledWith(expect.objectContaining({ take: REPORT_ROW_CAP }));
  });
});

describe('buildActivityReport — row cap', () => {
  it('passes REPORT_ROW_CAP as `take` to the query', async () => {
    findManyActivityLog.mockResolvedValueOnce([]);
    await buildActivityReport({ format: 'xlsx' } as never);
    expect(findManyActivityLog).toHaveBeenCalledWith(expect.objectContaining({ take: REPORT_ROW_CAP }));
  });
});
