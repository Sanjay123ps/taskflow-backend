import { z } from 'zod';

export const reportTypeParamSchema = z.object({
  type: z.enum(['tasks', 'staff', 'activity', 'attendance']),
});

const taskStatusEnum = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']);
const attendanceStatusEnum = z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'INCOMPLETE']);

// Phase 4 hardening: an unbounded dateFrom/dateTo span on the tasks/activity
// reports used to translate directly into an unbounded `findMany`. Rather
// than silently truncating results at the row cap (REPORT_ROW_CAP, see
// reports.service.ts) with no signal to the caller, we reject ranges wider
// than this up front so the requester gets a clear 422 and can narrow the
// filter instead of receiving a silently-truncated export.
const MAX_REPORT_RANGE_DAYS = 366;

export const reportQuerySchema = z
  .object({
    format: z.enum(['xlsx', 'csv']).default('xlsx'),
    staffId: z.string().uuid().optional(),
    // Shared across report types — each builder only reads what applies to
    // it (buildTasksReport reads task statuses, buildAttendanceReport reads
    // attendance statuses), same as staffId/dateFrom/dateTo are already
    // shared across every report type below.
    status: z.union([taskStatusEnum, attendanceStatusEnum]).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    // Attendance-only filters.
    department: z.string().optional(),
    search: z.string().trim().optional(),
    date: z.string().optional(),
  })
  .refine(
    (query) => {
      if (!query.dateFrom || !query.dateTo) return true;
      const from = new Date(query.dateFrom);
      const to = new Date(query.dateTo);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return true; // let downstream Date handling own malformed-date errors
      return to.getTime() >= from.getTime();
    },
    { message: 'dateTo must not be before dateFrom', path: ['dateTo'] },
  )
  .refine(
    (query) => {
      if (!query.dateFrom || !query.dateTo) return true;
      const from = new Date(query.dateFrom);
      const to = new Date(query.dateTo);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return true;
      const spanDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
      return spanDays <= MAX_REPORT_RANGE_DAYS;
    },
    { message: `Date range cannot exceed ${MAX_REPORT_RANGE_DAYS} days. Narrow the range and try again.`, path: ['dateTo'] },
  );

export type ReportTypeParam = z.infer<typeof reportTypeParamSchema>;
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
