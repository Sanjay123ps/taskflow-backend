import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import staffRoutes from '../modules/staff/staff.routes';
import taskRoutes from '../modules/tasks/tasks.routes';
import attendanceRoutes from '../modules/attendance/attendance.routes';
import notificationRoutes from '../modules/notifications/notifications.routes';
import signupRequestRoutes from '../modules/signup-requests/signup.routes';
import adminRequestRoutes from '../modules/admin-requests/adminRequest.routes';
import adminSignupRequestRoutes from '../modules/admin-signup-requests/adminSignup.routes';
import activityRoutes from '../modules/activities/activity.routes';
import { adminDashboardRouter, staffDashboardRouter } from '../modules/dashboard/dashboard.routes';
import messageRoutes from '../modules/messages/messages.routes';
import settingsRoutes from '../modules/settings/settings.routes';
import reportRoutes from '../modules/reports/reports.routes';
import profileRoutes from '../modules/profile/profile.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/staff', staffRoutes);
router.use('/tasks', taskRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/notifications', notificationRoutes);
router.use('/signup-requests', signupRequestRoutes);
router.use('/admin-requests', adminRequestRoutes);
router.use('/admin-signup-requests', adminSignupRequestRoutes);
router.use('/admin/activity', activityRoutes);
router.use('/admin', adminDashboardRouter); // GET /admin/dashboard
router.use('/', staffDashboardRouter); // GET /dashboard
router.use('/messages', messageRoutes);
router.use('/settings', settingsRoutes);
router.use('/reports', reportRoutes);
router.use('/profile', profileRoutes);

export default router;
