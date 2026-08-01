import { prisma } from '../../config/prisma';
import { toActivityLogDTO, toStaffMemberDTO, toTaskDTO } from '../../utils/dto';
import { computeTaskStatsForStaffIds } from '../tasks/task-stats.util';
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
 */
async function buildAnalytics(buckets: Bucket[]) {
  return Promise.all(
    buckets.map(async (bucket) => {
      const [created, completed, pending, overdue] = await Promise.all([
        prisma.task.count({ where: { createdAt: { gte: bucket.from, lt: bucket.to } } }),
        prisma.task.count({ where: { completedAt: { gte: bucket.from, lt: bucket.to } } }),
        prisma.task.count({
          where: { createdAt: { gte: bucket.from, lt: bucket.to }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        }),
        prisma.task.count({
          where: { createdAt: { gte: bucket.from, lt: bucket.to }, status: 'OVERDUE' },
        }),
      ]);
      return { label: bucket.label, created, completed, pending, overdue };
    }),
  );
}

export async function getAdminDashboardSummary(query: DashboardQueryInput) {
  await prisma.task.updateMany({
    where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, dueDate: { lt: new Date() }, completedAt: null },
    data: { status: 'OVERDUE' },
  });

  const buckets = buildBuckets(query.range);
  const rangeFrom = buckets[0]?.from ?? new Date(0);

  const [totalTasks, pendingTasks, completedTasks, overdueTasks, staff, recentActivityRows, analytics, counters] =
    await Promise.all([
      prisma.task.count(),
      prisma.task.count({ where: { status: 'PENDING' } }),
      prisma.task.count({ where: { status: 'COMPLETED' } }),
      prisma.task.count({ where: { status: 'OVERDUE' } }),
      prisma.profile.findMany({ where: { role: 'STAFF', status: 'ACTIVE' }, orderBy: { fullName: 'asc' } }),
      prisma.activityLog.findMany({
        include: { user: { select: { fullName: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      buildAnalytics(buckets),
      Promise.all([
        prisma.task.count({ where: { createdAt: { gte: rangeFrom } } }),
        prisma.task.count({ where: { completedAt: { gte: rangeFrom } } }),
        prisma.task.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, createdAt: { gte: rangeFrom } } }),
        prisma.task.count({ where: { status: 'OVERDUE', createdAt: { gte: rangeFrom } } }),
      ]),
    ]);

  const statsMap = await computeTaskStatsForStaffIds(staff.map((s) => s.id));
  const staffProgress = staff.map((s) => toStaffMemberDTO(s, statsMap.get(s.id)));

  const completionRate = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  return {
    kpis: { totalTasks, pendingTasks, completedTasks, completionRate },
    staffProgress,
    recentActivity: recentActivityRows.map(toActivityLogDTO),
    analytics,
    taskCounters: { created: counters[0], completed: counters[1], pending: counters[2], overdue: counters[3] },
  };
}

export async function getStaffDashboardSummary(authUser: AuthUser) {
  await prisma.task.updateMany({
    where: {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      dueDate: { lt: new Date() },
      completedAt: null,
      assignedToId: authUser.profileId,
    },
    data: { status: 'OVERDUE' },
  });

  const [totalTasks, pendingTasks, completedTasks, overdueTasks, upcomingTasksRows, recentActivityRows] =
    await Promise.all([
      prisma.task.count({ where: { assignedToId: authUser.profileId } }),
      prisma.task.count({ where: { assignedToId: authUser.profileId, status: 'PENDING' } }),
      prisma.task.count({ where: { assignedToId: authUser.profileId, status: 'COMPLETED' } }),
      prisma.task.count({ where: { assignedToId: authUser.profileId, status: 'OVERDUE' } }),
      prisma.task.findMany({
        where: { assignedToId: authUser.profileId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        include: { assignedTo: true, createdBy: true },
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

  const completionRate = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  return {
    kpis: { totalTasks, pendingTasks, completedTasks, overdueTasks, completionRate },
    upcomingTasks: upcomingTasksRows.map(toTaskDTO),
    recentActivity: recentActivityRows.map(toActivityLogDTO),
  };
}
