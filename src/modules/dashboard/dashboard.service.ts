import { prisma } from '../../config/prisma';
import { toActivityLogDTO, toStaffMemberDTO, toTaskDTO } from '../../utils/dto';
import { computeTaskStatsForStaffIds } from '../tasks/task-stats.util';
import { taskInclude } from '../tasks/tasks.service';
import type { AuthUser } from '../../types/authUser';
import type { DashboardQueryInput } from './dashboard.validation';

interface Bucket {
  label: string;
  from: Date;
  to: Date;
}

function buildBuckets(range: DashboardQueryInput['range']): Bucket[] {
  const now = new Date();
  const buckets: Bucket[] = [];

  if (range === 'today') {
    // Six 4-hour buckets covering the current day.
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    for (let i = 0; i < 6; i += 1) {
      const from = new Date(startOfDay.getTime() + i * 4 * 60 * 60 * 1000);
      const to = new Date(from.getTime() + 4 * 60 * 60 * 1000);
      buckets.push({ label: from.toLocaleTimeString('en-US', { hour: 'numeric' }), from, to });
    }
    return buckets;
  }

  if (range === 'month') {
    // Five weekly buckets covering the last ~35 days.
    for (let i = 4; i >= 0; i -= 1) {
      const to = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
      buckets.push({ label: from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), from, to });
    }
    return buckets;
  }

  // 'week' and 'custom' (custom dates aren't sent by the current frontend
  // call, so it falls back to the same 7-day view as 'week').
  for (let i = 6; i >= 0; i -= 1) {
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);
    to.setDate(to.getDate() - i);
    const from = new Date(to);
    from.setHours(0, 0, 0, 0);
    buckets.push({ label: from.toLocaleDateString('en-US', { weekday: 'short' }), from, to });
  }
  return buckets;
}

/**
 * Per-bucket "pending"/"overdue" counts reflect the *current* status of
 * tasks created within that bucket window, not a true historical snapshot
 * of status-at-that-time — the schema doesn't track a status change
 * history, so a fully time-accurate series would need event sourcing.
 * "created" and "completed" counts, by contrast, are exact (based on
 * createdAt / completedAt timestamps).
 *
 * Phase 3 audit finding: this used to run 4 separate `count()` queries
 * per bucket (up to 24 queries for the 'today'/'month' views, since
 * those have 6 and 5 buckets respectively). All four counts are drawn
 * from the same underlying rows and the same overall time window, so
 * instead of N*4 round trips this now does exactly one `findMany` for the
 * whole window (selecting only the 3 columns actually needed) and buckets
 * the rows in memory. Semantics are identical to the original per-query
 * predicates below; a task volume that made pulling those rows expensive
 * would be better served by a single raw SQL conditional-aggregation
 * query, but that couldn't be verified against a live Postgres instance
 * in this environment (see final report) so the safer, fully
 * unit-testable option was chosen here.
 */
async function buildAnalytics(buckets: Bucket[]) {
  if (buckets.length === 0) return [];

  const rangeStart = buckets[0].from;
  const rangeEnd = buckets[buckets.length - 1].to;

  const rows = await prisma.task.findMany({
    where: {
      OR: [
        { createdAt: { gte: rangeStart, lt: rangeEnd } },
        { completedAt: { gte: rangeStart, lt: rangeEnd } },
      ],
    },
    select: { createdAt: true, completedAt: true, status: true },
  });

  return buckets.map((bucket) => {
    let created = 0;
    let completed = 0;
    let pending = 0;
    let overdue = 0;

    for (const row of rows) {
      const createdInBucket = row.createdAt >= bucket.from && row.createdAt < bucket.to;
      if (createdInBucket) {
        created += 1;
        if (row.status === 'PENDING' || row.status === 'IN_PROGRESS') pending += 1;
        else if (row.status === 'OVERDUE') overdue += 1;
      }
      if (row.completedAt && row.completedAt >= bucket.from && row.completedAt < bucket.to) {
        completed += 1;
      }
    }

    return { label: bucket.label, created, completed, pending, overdue };
  });
}

export async function getAdminDashboardSummary(query: DashboardQueryInput) {
  // Overdue sync no longer runs here — see overdue.service.ts. A GET
  // endpoint performing a table UPDATE on every load was exactly the
  // Phase 2/3 anti-pattern this audit was asked to find.
  const buckets = buildBuckets(query.range);

  const [statusCounts, staff, recentActivityRows, analytics] = await Promise.all([
    // Replaces 4 separate `count()` calls (total/pending/completed/overdue)
    // with a single groupBy — same total round trips as before this
    // change would have needed just for one of those four.
    prisma.task.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.profile.findMany({ where: { role: 'STAFF', status: 'ACTIVE' }, orderBy: { fullName: 'asc' } }),
    prisma.activityLog.findMany({
      include: { user: { select: { fullName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    buildAnalytics(buckets),
  ]);

  const countFor = (status: string) => statusCounts.find((row) => row.status === status)?._count._all ?? 0;
  const totalTasks = statusCounts.reduce((sum, row) => sum + row._count._all, 0);
  const pendingTasks = countFor('PENDING');
  const completedTasks = countFor('COMPLETED');

  const statsMap = await computeTaskStatsForStaffIds(staff.map((s) => s.id));
  const staffProgress = staff.map((s) => toStaffMemberDTO(s, statsMap.get(s.id)));

  const completionRate = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  // The previous "counters" block ran 4 more count() queries scoped to
  // `createdAt >= rangeFrom` (the start of the bucket window, unbounded
  // above). Since the buckets returned by buildBuckets() always tile that
  // exact same window with no gaps or overlaps, that's provably just the
  // sum of the analytics series — no extra queries needed to get it.
  const taskCounters = analytics.reduce(
    (totals, bucket) => ({
      created: totals.created + bucket.created,
      completed: totals.completed + bucket.completed,
      pending: totals.pending + bucket.pending,
      overdue: totals.overdue + bucket.overdue,
    }),
    { created: 0, completed: 0, pending: 0, overdue: 0 },
  );

  return {
    kpis: { totalTasks, pendingTasks, completedTasks, completionRate },
    staffProgress,
    recentActivity: recentActivityRows.map(toActivityLogDTO),
    analytics,
    taskCounters,
  };
}

export async function getStaffDashboardSummary(authUser: AuthUser) {
  // The per-staff overdue UPDATE that used to run here was a second,
  // narrower copy of the same statement the admin dashboard ran and the
  // one syncOverdueTasks() ran on every task read — three independent
  // implementations of one idea. The background job in overdue.service.ts
  // covers every task org-wide (a superset of this staff member's tasks),
  // so nothing here needs to trigger its own sync anymore.
  const [statusCounts, upcomingTasksRows, recentActivityRows] = await Promise.all([
    // Consolidates what were 4 separate count() calls into 1 groupBy.
    // Deliberately NOT reusing task-stats.util.ts's
    // computeTaskStatsForStaffIds here: that helper folds IN_PROGRESS into
    // its "pending" bucket, whereas this dashboard's `pendingTasks` KPI
    // has always meant status === 'PENDING' only (IN_PROGRESS tasks count
    // toward totalTasks but not toward any of the four KPI tiles below —
    // a pre-existing quirk, preserved here rather than changed, since
    // fixing it wasn't part of this scalability pass).
    prisma.task.groupBy({ by: ['status'], where: { assignedToId: authUser.profileId }, _count: { _all: true } }),
    prisma.task.findMany({
      where: { assignedToId: authUser.profileId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      include: taskInclude,
      orderBy: { dueDate: 'asc' },
      take: 5,
    }),
    prisma.activityLog.findMany({
      where: { userId: authUser.profileId },
      include: { user: { select: { fullName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const countFor = (status: string) => statusCounts.find((row) => row.status === status)?._count._all ?? 0;
  const totalTasks = statusCounts.reduce((sum, row) => sum + row._count._all, 0);
  const pendingTasks = countFor('PENDING');
  const completedTasks = countFor('COMPLETED');
  const overdueTasks = countFor('OVERDUE');

  const completionRate = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  return {
    kpis: { totalTasks, pendingTasks, completedTasks, overdueTasks, completionRate },
    upcomingTasks: upcomingTasksRows.map(toTaskDTO),
    recentActivity: recentActivityRows.map(toActivityLogDTO),
  };
}
