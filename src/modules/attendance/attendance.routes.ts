import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin, requireStaff } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import {
  checkInHandler,
  checkOutHandler,
  getAttendanceHandler,
  getAttendanceSummaryHandler,
  getMyAttendanceHandler,
  listAttendanceHandler,
  listStaffAttendanceHandler,
} from './attendance.controller';
import { attendanceIdParamSchema, attendanceQuerySchema, staffIdParamSchema } from './attendance.validation';

const router = Router();

router.use(requireAuth);

// Full attendance management (every staff member, every filter) is
// Admin-only — a STAFF token gets a 403 here, same as any other
// Admin-only route in this API.
router.get('/summary', requireAdmin, getAttendanceSummaryHandler);
router.get('/', requireAdmin, validate(attendanceQuerySchema, 'query'), listAttendanceHandler);

// Staff self-service: today's attendance + Mark Arrival / Mark Logout.
// These must be declared before the generic '/:id' route below, or
// Express would try to match "me" / "check-in" / "check-out" against the
// :id param (and fail uuid validation) instead of reaching these handlers.
// The backend is always the source of truth for the timestamp — no time
// value is ever accepted from the frontend here.
router.get('/me', requireStaff, getMyAttendanceHandler);
router.post('/check-in', requireStaff, checkInHandler);
router.post('/check-out', requireStaff, checkOutHandler);

// Staff can only ever reach their own records through these two —
// enforced in attendance.service.ts, not just here.
router.get(
  '/staff/:staffId',
  validate(staffIdParamSchema, 'params'),
  validate(attendanceQuerySchema, 'query'),
  listStaffAttendanceHandler,
);
router.get('/:id', validate(attendanceIdParamSchema, 'params'), getAttendanceHandler);

export default router;
