import { z } from 'zod';

export const reportTypeParamSchema = z.object({
  type: z.enum(['tasks', 'staff', 'activity', 'attendance']),
});

const taskStatusEnum = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']);
const attendanceStatusEnum = z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'INCOMPLETE']);

export const reportQuerySchema = z.object({
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
});

export type ReportTypeParam = z.infer<typeof reportTypeParamSchema>;
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
