import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { computeTaskStatsForStaffIds } from '../tasks/task-stats.util';
import { listAttendanceForExport } from '../attendance/attendance.service';
import type { AttendanceQueryInput } from '../attendance/attendance.validation';
import type { AuthUser } from '../../types/authUser';
import type { ReportQueryInput } from './reports.validation';

export interface ReportColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ReportData {
  filename: string;
  // When true, the download handler uses `filename` exactly as given
  // instead of appending its own "-YYYY-MM-DD" suffix — used by the
  // Attendance report so the filename can encode the selected date
  // range instead of "today" (see buildAttendanceReport below).
  finalFilename?: boolean;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
}

function dateRangeWhere(field: string, dateFrom?: string, dateTo?: string): Record<string, unknown> {
  if (!dateFrom && !dateTo) return {};
  return {
    [field]: {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    },
  };
}

export async function buildTasksReport(query: ReportQueryInput): Promise<ReportData> {
  const where: Prisma.TaskWhereInput = {
    ...(query.staffId ? { assignedToId: query.staffId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...dateRangeWhere('dueDate', query.dateFrom, query.dateTo),
  };

  const tasks = await prisma.task.findMany({
    where,
    include: { assignedTo: true, createdBy: true },
    orderBy: { dueDate: 'asc' },
  });

  return {
    filename: 'tasks-report',
    columns: [
      { header: 'Title', key: 'title', width: 32 },
      { header: 'Assigned To', key: 'assignedTo', width: 22 },
      { header: 'Employee ID', key: 'employeeId', width: 14 },
      { header: 'Created By', key: 'createdBy', width: 22 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Due Date', key: 'dueDate', width: 14 },
      { header: 'Due Time', key: 'dueTime', width: 10 },
      { header: 'Completed At', key: 'completedAt', width: 20 },
    ],
    rows: tasks.map((t) => ({
      title: t.title,
      assignedTo: t.assignedTo?.fullName ?? 'Unassigned',
      employeeId: t.assignedTo?.employeeId ?? '',
      createdBy: t.createdBy.fullName,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate.toISOString().slice(0, 10),
      dueTime: t.dueTime,
      completedAt: t.completedAt ? t.completedAt.toISOString() : '',
    })),
  };
}

export async function buildStaffReport(query: ReportQueryInput): Promise<ReportData> {
  const staff = await prisma.profile.findMany({
    where: { role: 'STAFF', status: { not: 'PENDING' }, ...(query.staffId ? { id: query.staffId } : {}) },
    orderBy: { fullName: 'asc' },
  });

  const statsMap = await computeTaskStatsForStaffIds(staff.map((s) => s.id));

  return {
    filename: 'staff-report',
    columns: [
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Employee ID', key: 'employeeId', width: 14 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Department', key: 'department', width: 18 },
      { header: 'Designation', key: 'designation', width: 18 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Total Tasks', key: 'total', width: 12 },
      { header: 'Completed', key: 'completed', width: 12 },
      { header: 'Pending', key: 'pending', width: 12 },
      { header: 'Overdue', key: 'overdue', width: 12 },
      { header: 'Completion %', key: 'completionRate', width: 14 },
    ],
    rows: staff.map((s) => {
      const stats = statsMap.get(s.id) ?? { total: 0, completed: 0, pending: 0, overdue: 0 };
      const completionRate = stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * 100);
      return {
        name: s.fullName,
        employeeId: s.employeeId ?? '',
        email: s.email,
        department: s.department ?? '',
        designation: s.designation ?? '',
        status: s.status,
        total: stats.total,
        completed: stats.completed,
        pending: stats.pending,
        overdue: stats.overdue,
        completionRate,
      };
    }),
  };
}

export async function buildActivityReport(query: ReportQueryInput): Promise<ReportData> {
  const where: Prisma.ActivityLogWhereInput = {
    ...(query.staffId ? { userId: query.staffId } : {}),
    ...dateRangeWhere('createdAt', query.dateFrom, query.dateTo),
  };

  const rows = await prisma.activityLog.findMany({
    where,
    include: { user: { select: { fullName: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: 5000, // hard cap so a huge unfiltered export can't exhaust memory
  });

  return {
    filename: 'activity-report',
    columns: [
      { header: 'Date', key: 'createdAt', width: 20 },
      { header: 'User', key: 'userName', width: 22 },
      { header: 'Role', key: 'userRole', width: 10 },
      { header: 'Action', key: 'action', width: 24 },
      { header: 'Description', key: 'description', width: 48 },
    ],
    rows: rows.map((r) => ({
      createdAt: r.createdAt.toISOString(),
      userName: r.user.fullName,
      userRole: r.user.role,
      action: r.action,
      description: r.description,
    })),
  };
}

function formatWorkingHours(totalMinutes: number | null): string {
  if (totalMinutes == null) return '';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function formatClockTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Builds the "Attendance Reports" export. Filtering is entirely
 * delegated to attendance.service.ts's listAttendanceForExport — the
 * exact same logic that powers the live Attendance page — so the two
 * can never disagree about what a given filter combination returns.
 */
export async function buildAttendanceReport(query: ReportQueryInput, authUser: AuthUser): Promise<ReportData> {
  const records = await listAttendanceForExport(
    {
      staffId: query.staffId,
      department: query.department,
      status: query.status as AttendanceQueryInput['status'], // validated against the shared enum in reports.validation.ts
      date: query.date,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      search: query.search,
    },
    authUser,
  );

  // Filename encodes the selected range, per spec:
  //   Attendance_Report_2026-07-01_to_2026-07-28.xlsx
  //   Attendance_Report_2026-07-28.xlsx
  //   Attendance_Report_All.xlsx  (no date filter at all)
  let filename = 'Attendance_Report_All';
  if (query.date) {
    filename = `Attendance_Report_${query.date}`;
  } else if (query.dateFrom && query.dateTo) {
    filename = query.dateFrom === query.dateTo
      ? `Attendance_Report_${query.dateFrom}`
      : `Attendance_Report_${query.dateFrom}_to_${query.dateTo}`;
  } else if (query.dateFrom || query.dateTo) {
    filename = `Attendance_Report_${query.dateFrom ?? 'start'}_to_${query.dateTo ?? 'now'}`;
  }

  return {
    filename,
    finalFilename: true,
    columns: [
      { header: 'Staff Name', key: 'staffName', width: 22 },
      { header: 'Employee ID', key: 'employeeId', width: 14 },
      { header: 'Department', key: 'department', width: 18 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Login Time', key: 'loginTime', width: 14 },
      { header: 'Logout Time', key: 'logoutTime', width: 14 },
      { header: 'Total Working Hours', key: 'workingHours', width: 16 },
      { header: 'Attendance Status', key: 'status', width: 16 },
    ],
    rows: records.map((r) => ({
      staffName: r.staffName,
      employeeId: r.employeeId,
      department: r.department,
      date: r.date,
      loginTime: formatClockTime(r.loginTime),
      logoutTime: formatClockTime(r.logoutTime),
      workingHours: formatWorkingHours(r.totalWorkingMinutes),
      status: r.status,
    })),
  };
}
