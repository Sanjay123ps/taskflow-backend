import { prisma } from '../../config/prisma';
import type { StaffTaskStatsInput } from '../../utils/dto';

const EMPTY_STATS: StaffTaskStatsInput = { total: 0, completed: 0, pending: 0, overdue: 0 };

/**
 * Computes { total, completed, pending, overdue } for every staff id given,
 * in a single grouped query. Nothing here is persisted — dashboards and
 * staff listings always recompute from live Task rows.
 */
export async function computeTaskStatsForStaffIds(
  staffIds: string[],
): Promise<Map<string, StaffTaskStatsInput>> {
  const map = new Map<string, StaffTaskStatsInput>();
  if (staffIds.length === 0) return map;

  const rows = await prisma.task.groupBy({
    by: ['assignedToId', 'status'],
    where: { assignedToId: { in: staffIds } },
    _count: { _all: true },
  });

  for (const id of staffIds) {
    map.set(id, { ...EMPTY_STATS });
  }

  for (const row of rows) {
    if (!row.assignedToId) continue;
    const stats = map.get(row.assignedToId) ?? { ...EMPTY_STATS };
    stats.total += row._count._all;
    if (row.status === 'COMPLETED') stats.completed += row._count._all;
    else if (row.status === 'OVERDUE') stats.overdue += row._count._all;
    else stats.pending += row._count._all; // PENDING + IN_PROGRESS both count as "pending" for this rollup
    map.set(row.assignedToId, stats);
  }

  return map;
}

export async function computeTaskStatsForStaff(staffId: string): Promise<StaffTaskStatsInput> {
  const map = await computeTaskStatsForStaffIds([staffId]);
  return map.get(staffId) ?? { ...EMPTY_STATS };
}
