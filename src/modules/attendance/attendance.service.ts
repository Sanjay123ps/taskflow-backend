import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toAttendanceDTO } from '../../utils/dto';
import { buildPaginatedResult, normalizePagination, type NormalizedPagination } from '../../utils/pagination';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors';
import type { AuthUser } from '../../types/authUser';
import type { AttendanceQueryInput } from './attendance.validation';

// A staff member who logs in after this time is marked LATE. There's no
// per-department shift configuration in the schema yet, so this is a
// single global cutoff — promote to a SystemSetting if that's ever needed.
const LATE_CUTOFF_HOUR = 9;
const LATE_CUTOFF_MINUTE = 15;

// A completed day with less than this many minutes worked is recorded as
// HALF_DAY rather than PRESENT/LATE.
const HALF_DAY_THRESHOLD_MINUTES = 240; // 4 hours

/**
 * Returns a Date representing a given day at UTC-midnight, matching the
 * `@db.Date` column so no off-by-one-day shift occurs when Prisma stores
 * it, regardless of the server's own timezone. "Today" is determined
 * using the server process's local clock — set the TZ env var (e.g.
 * TZ=Asia/Kolkata) in your deployment so "today" and the late-arrival
 * cutoff below line up with your actual business timezone.
 */
function dateOnly(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Lazily flips any attendance row from a *previous* day that never
 * received a logout into INCOMPLETE — same pattern as the OVERDUE-task
 * sync in tasks.service.ts, so no cron job is needed. Called at the top
 * of every read path.
 */
async function syncIncompleteAttendance(): Promise<void> {
  await prisma.attendance.updateMany({
    where: { date: { lt: dateOnly() }, logoutTime: null, status: { not: 'INCOMPLETE' } },
    data: { status: 'INCOMPLETE' },
  });
}

/**
 * Called from auth.service.ts on a successful STAFF login. Creates
 * today's attendance row on first login of the day; a second login the
 * same day (e.g. a page refresh re-authenticating) is a no-op so the
 * original login time and status aren't overwritten.
 */
export async function recordLogin(staffId: string): Promise<void> {
  const now = new Date();
  const today = dateOnly(now);

  const existing = await prisma.attendance.findUnique({ where: { staffId_date: { staffId, date: today } } });
  if (existing) return;

  const isLate =
    now.getHours() > LATE_CUTOFF_HOUR || (now.getHours() === LATE_CUTOFF_HOUR && now.getMinutes() > LATE_CUTOFF_MINUTE);

  await prisma.attendance.create({
    data: { staffId, date: today, loginTime: now, status: isLate ? 'LATE' : 'PRESENT' },
  });
}

/**
 * Called from auth.service.ts on a STAFF logout. No-ops if there's no
 * login recorded for today, or if logout was already recorded (so a
 * double logout call can never corrupt the working-hours calculation).
 */
export async function recordLogout(staffId: string): Promise<void> {
  const now = new Date();
  const today = dateOnly(now);

  const existing = await prisma.attendance.findUnique({ where: { staffId_date: { staffId, date: today } } });
  if (!existing || !existing.loginTime || existing.logoutTime) return;

  const totalWorkingMinutes = Math.max(0, Math.round((now.getTime() - existing.loginTime.getTime()) / 60000));
  const status = totalWorkingMinutes < HALF_DAY_THRESHOLD_MINUTES ? 'HALF_DAY' : existing.status;

  await prisma.attendance.update({
    where: { id: existing.id },
    data: { logoutTime: now, totalWorkingMinutes, status },
  });
}

/**
 * Staff-triggered "Mark Arrival" / "Mark Logout" actions (Staff Attendance
 * page), as opposed to recordLogin/recordLogout above which fire silently
 * on the web session's own login/logout. Both write to the exact same
 * Attendance row (staffId + today), so Admin's Attendance page and the
 * Staff Portal are always looking at identical data — there is no second
 * table. Unlike recordLogin/recordLogout, these throw on a redundant call
 * so the UI can tell the staff member what actually happened.
 */
export async function checkIn(authUser: AuthUser) {
  if (authUser.role !== 'STAFF') {
    throw new ForbiddenError('Only staff accounts can check in.');
  }

  const staffId = authUser.profileId;
  const now = new Date();
  const today = dateOnly(now);

  const existing = await prisma.attendance.findUnique({ where: { staffId_date: { staffId, date: today } } });
  if (existing?.loginTime) {
    throw new ConflictError('You have already checked in today.');
  }

  const isLate =
    now.getHours() > LATE_CUTOFF_HOUR || (now.getHours() === LATE_CUTOFF_HOUR && now.getMinutes() > LATE_CUTOFF_MINUTE);
  const status = isLate ? 'LATE' : 'PRESENT';

  const record = existing
    ? await prisma.attendance.update({
        where: { id: existing.id },
        data: { loginTime: now, status },
        include: attendanceInclude,
      })
    : await prisma.attendance.create({
        data: { staffId, date: today, loginTime: now, status },
        include: attendanceInclude,
      });

  return toAttendanceDTO(record);
}

export async function checkOut(authUser: AuthUser) {
  if (authUser.role !== 'STAFF') {
    throw new ForbiddenError('Only staff accounts can check out.');
  }

  const staffId = authUser.profileId;
  const now = new Date();
  const today = dateOnly(now);

  const existing = await prisma.attendance.findUnique({
    where: { staffId_date: { staffId, date: today } },
    include: attendanceInclude,
  });
  if (!existing || !existing.loginTime) {
    throw new BadRequestError('You need to check in before you can check out.');
  }
  if (existing.logoutTime) {
    throw new ConflictError('You have already checked out today.');
  }

  const totalWorkingMinutes = Math.max(0, Math.round((now.getTime() - existing.loginTime.getTime()) / 60000));
  const status = totalWorkingMinutes < HALF_DAY_THRESHOLD_MINUTES ? 'HALF_DAY' : existing.status;

  const record = await prisma.attendance.update({
    where: { id: existing.id },
    data: { logoutTime: now, totalWorkingMinutes, status },
    include: attendanceInclude,
  });

  return toAttendanceDTO(record);
}

/**
 * Powers the Staff Attendance card ("Good Morning, {name}! Today's
 * Attendance"). Returns null when the staff member hasn't checked in yet
 * today rather than a synthesized ABSENT row — the frontend renders the
 * "Mark Arrival" button in that case.
 */
export async function getMyAttendanceToday(authUser: AuthUser) {
  if (authUser.role !== 'STAFF') {
    throw new ForbiddenError('Only staff accounts have attendance records.');
  }

  await syncIncompleteAttendance();

  const record = await prisma.attendance.findUnique({
    where: { staffId_date: { staffId: authUser.profileId, date: dateOnly() } },
    include: attendanceInclude,
  });

  return record ? toAttendanceDTO(record) : null;
}

const attendanceInclude = { staff: true } as const;

function baseWhere(params: AttendanceQueryInput): Prisma.AttendanceWhereInput {
  return {
    ...(params.staffId ? { staffId: params.staffId } : {}),
    ...(params.status && params.status !== 'ALL' && params.status !== 'ABSENT' ? { status: params.status } : {}),
    ...(params.department ? { staff: { department: params.department } } : {}),
    ...(params.date
      ? { date: new Date(params.date) }
      : params.dateFrom || params.dateTo
        ? {
            date: {
              ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
              ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
            },
          }
        : {}),
    ...(params.search
      ? {
          staff: {
            ...(params.department ? { department: params.department } : {}),
            OR: [
              { fullName: { contains: params.search, mode: 'insensitive' } },
              { employeeId: { contains: params.search, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
  };
}

// Safety cap so an unfiltered export can't exhaust memory — same
// convention as buildActivityReport's 5000-row cap.
const EXPORT_ROW_CAP = 5000;

/**
 * Shared by listAbsentees (paginated, for the Attendance page) and
 * listAttendanceForExport (uncapped-ish, for reports) so the "who's
 * absent" logic only lives in one place.
 */
async function resolveAbsentees(params: AttendanceQueryInput, authUser: AuthUser) {
  const targetDate = dateOnly(params.date ? new Date(params.date) : new Date());

  const staffWhere: Prisma.ProfileWhereInput = {
    role: 'STAFF',
    status: 'ACTIVE',
    ...(authUser.role === 'STAFF' ? { id: authUser.profileId } : {}),
    ...(params.staffId ? { id: params.staffId } : {}),
    ...(params.department ? { department: params.department } : {}),
    ...(params.search
      ? {
          OR: [
            { fullName: { contains: params.search, mode: 'insensitive' } },
            { employeeId: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [staffList, presentRows] = await Promise.all([
    prisma.profile.findMany({ where: staffWhere, orderBy: { fullName: 'asc' } }),
    prisma.attendance.findMany({ where: { date: targetDate }, select: { staffId: true } }),
  ]);

  const presentIds = new Set(presentRows.map((r) => r.staffId));
  const absentees = staffList.filter((s) => !presentIds.has(s.id));

  return { targetDate, absentees };
}

/**
 * ABSENT has no stored row — it means "no login happened" — so it can't
 * be paginated straight out of the attendance table like the other
 * statuses. Instead this computes it for a single day (defaults to
 * today): every ACTIVE staff member matching the other filters minus
 * whoever already has an attendance row for that day.
 */
async function listAbsentees(params: AttendanceQueryInput, authUser: AuthUser, pagination: NormalizedPagination) {
  const { targetDate, absentees } = await resolveAbsentees(params, authUser);

  const total = absentees.length;
  const page = absentees.slice(pagination.skip, pagination.skip + pagination.take);

  return buildPaginatedResult(
    page.map((staff) => toAttendanceDTO(null, staff, targetDate)),
    total,
    pagination,
  );
}

export async function listAttendance(params: AttendanceQueryInput, authUser: AuthUser) {
  await syncIncompleteAttendance();
  const pagination = normalizePagination(params);

  if (params.status === 'ABSENT') {
    return listAbsentees(params, authUser, pagination);
  }

  let where = baseWhere(params);
  if (authUser.role === 'STAFF') {
    where = { ...where, staffId: authUser.profileId };
  }

  const [rows, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      include: attendanceInclude,
      orderBy: [{ date: 'desc' }, { loginTime: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.attendance.count({ where }),
  ]);

  return buildPaginatedResult(rows.map((row) => toAttendanceDTO(row)), total, pagination);
}

export async function getAttendanceById(id: string, authUser: AuthUser) {
  const record = await prisma.attendance.findUnique({ where: { id }, include: attendanceInclude });
  if (!record) throw new NotFoundError('Attendance record not found');
  if (authUser.role === 'STAFF' && record.staffId !== authUser.profileId) {
    throw new ForbiddenError("You don't have permission to view this attendance record.");
  }
  return toAttendanceDTO(record);
}

export async function listStaffAttendance(staffId: string, params: AttendanceQueryInput, authUser: AuthUser) {
  if (authUser.role === 'STAFF' && staffId !== authUser.profileId) {
    throw new ForbiddenError("You don't have permission to view this staff member's attendance.");
  }
  return listAttendance({ ...params, staffId }, authUser);
}

export async function getAttendanceSummary() {
  await syncIncompleteAttendance();
  const today = dateOnly();

  const [totalStaff, todaysRows] = await Promise.all([
    prisma.profile.count({ where: { role: 'STAFF', status: 'ACTIVE' } }),
    prisma.attendance.findMany({ where: { date: today }, select: { status: true } }),
  ]);

  const countOf = (status: string) => todaysRows.filter((r) => r.status === status).length;
  const presentToday = countOf('PRESENT');
  const lateToday = countOf('LATE');
  const halfDayToday = countOf('HALF_DAY');
  const incompleteToday = countOf('INCOMPLETE');
  const absentToday = Math.max(0, totalStaff - todaysRows.length);

  return { totalStaff, presentToday, lateToday, halfDayToday, incompleteToday, absentToday };
}

/**
 * Unpaginated variant of listAttendance, used by reports.service.ts to
 * build the Attendance Reports export — reuses the exact same
 * baseWhere/resolveAbsentees filtering so the Attendance page and its
 * export can never drift apart. Capped at EXPORT_ROW_CAP rows so a fully
 * unfiltered export can't exhaust memory (same convention as the
 * existing Activity report).
 */
export async function listAttendanceForExport(params: AttendanceQueryInput, authUser: AuthUser) {
  await syncIncompleteAttendance();

  if (params.status === 'ABSENT') {
    const { targetDate, absentees } = await resolveAbsentees(params, authUser);
    return absentees.slice(0, EXPORT_ROW_CAP).map((staff) => toAttendanceDTO(null, staff, targetDate));
  }

  let where = baseWhere(params);
  if (authUser.role === 'STAFF') {
    where = { ...where, staffId: authUser.profileId };
  }

  const rows = await prisma.attendance.findMany({
    where,
    include: attendanceInclude,
    orderBy: [{ date: 'desc' }, { loginTime: 'desc' }],
    take: EXPORT_ROW_CAP,
  });

  return rows.map((row) => toAttendanceDTO(row));
}
