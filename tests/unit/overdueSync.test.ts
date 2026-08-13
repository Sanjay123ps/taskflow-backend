import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { updateMany, errorLog } = vi.hoisted(() => ({
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  errorLog: vi.fn(),
}));

vi.mock('../../src/config/prisma', () => ({
  prisma: { task: { updateMany } },
}));

vi.mock('../../src/config/logger', () => ({
  logger: { error: errorLog, info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { syncOverdueTasks, startOverdueSyncJob } from '../../src/modules/tasks/overdue.service';

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 0 });
  errorLog.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('syncOverdueTasks', () => {
  it('only flips PENDING/IN_PROGRESS tasks with a past due date and no completedAt', async () => {
    await syncOverdueTasks();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        dueDate: { lt: expect.any(Date) },
        completedAt: null,
      },
      data: { status: 'OVERDUE' },
    });
  });

  it('returns the number of rows flipped', async () => {
    updateMany.mockResolvedValue({ count: 7 });
    await expect(syncOverdueTasks()).resolves.toBe(7);
  });
});

describe('startOverdueSyncJob', () => {
  it('runs once immediately on start, without waiting for the first interval', async () => {
    const handle = startOverdueSyncJob(60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(updateMany).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('re-runs on each interval tick', async () => {
    const handle = startOverdueSyncJob(60_000);
    await vi.advanceTimersByTimeAsync(0); // initial run
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(updateMany).toHaveBeenCalledTimes(3);
    handle.stop();
  });

  it('stops scheduling further ticks once stopped', async () => {
    const handle = startOverdueSyncJob(60_000);
    await vi.advanceTimersByTimeAsync(0);
    handle.stop();
    const callsAtStop = updateMany.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(updateMany).toHaveBeenCalledTimes(callsAtStop);
  });

  it('logs and survives a failed tick instead of throwing or halting the schedule', async () => {
    updateMany.mockRejectedValueOnce(new Error('db unreachable')).mockResolvedValue({ count: 0 });
    const handle = startOverdueSyncJob(60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(errorLog).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(updateMany).toHaveBeenCalledTimes(2);
    handle.stop();
  });
});
