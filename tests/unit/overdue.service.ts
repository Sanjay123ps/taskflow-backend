import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';

/**
 * Flips PENDING/IN_PROGRESS tasks whose due date has passed into OVERDUE.
 * A single conditional UPDATE, scoped by the existing (status, dueDate)
 * indexes.
 *
 * Phase 2 audit finding: this used to run inline at the top of every read
 * path (`GET /tasks`, `GET /tasks/:id`, both dashboard summaries — three
 * separate copies of essentially this same statement), meaning ordinary
 * read requests were performing a write on every call. It's now called
 * only from the background job below (see `startOverdueSyncJob`), which
 * is the single place in the codebase that performs this update.
 *
 * Worst-case staleness this introduces: up to `intervalMs` (default 60s)
 * between a task's due moment and its `status` column actually flipping
 * to OVERDUE. In practice this is not a meaningful behavior change:
 * `dueDate` is stored as a calendar date (the separate `dueTime` string is
 * display-only and isn't factored into this comparison anywhere in the
 * codebase today), so a task's overdue flip already only had day-level
 * precision — going from "instant on next read" to "within 60s of a
 * background tick" is negligible against that existing granularity.
 */
export async function syncOverdueTasks(): Promise<number> {
  const result = await prisma.task.updateMany({
    where: {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      dueDate: { lt: new Date() },
      completedAt: null,
    },
    data: { status: 'OVERDUE' },
  });
  return result.count;
}

export interface OverdueSyncHandle {
  stop: () => void;
}

/**
 * Starts a self-scheduling interval that keeps Task.status in sync with
 * due dates, replacing the old "sync on every GET" pattern.
 *
 * - Self-scheduling (setTimeout-after-completion, not setInterval) so a
 *   slow tick can never overlap with the next one.
 * - A DB error on one tick is logged and swallowed, not thrown, so a
 *   transient blip doesn't crash the process or stop future ticks.
 * - Safe to run redundantly across multiple backend instances: the
 *   underlying UPDATE is idempotent (a row that's already OVERDUE, or
 *   whose due date hasn't passed, simply isn't matched by the WHERE
 *   clause), so at most it means a little duplicated work — never a
 *   correctness issue. If this ever needs to be de-duplicated across
 *   instances, moving it to a single Postgres-side `pg_cron` job (Supabase
 *   supports this extension) would remove the redundancy without adding
 *   new infrastructure — worth considering in a later phase, not now.
 */
export function startOverdueSyncJob(intervalMs = 60_000): OverdueSyncHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick() {
    if (stopped) return;
    try {
      await syncOverdueTasks();
    } catch (err) {
      logger.error({ err }, 'Overdue-task sync tick failed; will retry on the next interval.');
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
        timer.unref?.();
      }
    }
  }

  void tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
