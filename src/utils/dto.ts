import type {
  ActivityLog,
  Attendance,
  Message,
  Notification,
  Profile,
  StaffSignupRequest,
  AdminCreationRequest,
  AdminSignupRequest,
  Task,
  TaskComment,
} from '@prisma/client';

// ---------------------------------------------------------------------
// Profile / Staff / Admin
// ---------------------------------------------------------------------

export function toAdminProfileDTO(profile: Profile) {
  return {
    id: profile.id,
    name: profile.fullName,
    email: profile.email,
    role: profile.role,
    profileImage: profile.profileImageUrl,
  };
}

export interface StaffTaskStatsInput {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
}

export function toStaffMemberDTO(profile: Profile, taskStats?: StaffTaskStatsInput) {
  return {
    id: profile.id,
    name: profile.fullName,
    employeeId: profile.employeeId ?? '',
    email: profile.email,
    phone: profile.phone ?? '',
    department: profile.department ?? '',
    designation: profile.designation ?? '',
    role: profile.role,
    // Frontend only models ACTIVE | INACTIVE — collapse SUSPENDED/PENDING
    // to INACTIVE for display purposes while the DB retains the detail.
    status: profile.status === 'ACTIVE' ? ('ACTIVE' as const) : ('INACTIVE' as const),
    profileImage: profile.profileImageUrl,
    joiningDate: profile.joiningDate ? profile.joiningDate.toISOString() : '',
    presenceStatus: profile.presenceStatus,
    lastActiveAt: profile.lastActiveAt ? profile.lastActiveAt.toISOString() : null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
    ...(taskStats
      ? {
          taskStats: {
            ...taskStats,
            completionRate: taskStats.total === 0 ? 0 : Math.round((taskStats.completed / taskStats.total) * 100),
          },
        }
      : {}),
  };
}

export function toPresenceStatusDTO(profile: Profile) {
  return {
    status: profile.presenceStatus,
    lastActiveAt: profile.lastActiveAt ? profile.lastActiveAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------

type TaskWithRelations = Task & {
  assignedTo: Profile | null;
  createdBy?: Profile;
};

export function toTaskDTO(task: TaskWithRelations) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    assignedTo: task.assignedTo
      ? {
          id: task.assignedTo.id,
          name: task.assignedTo.fullName,
          employeeId: task.assignedTo.employeeId ?? '',
          profileImage: task.assignedTo.profileImageUrl,
        }
      : null,
    createdById: task.createdById,
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate.toISOString(),
    dueTime: task.dueTime,
    attachmentUrl: task.attachmentUrl,
    notes: task.notes,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function toTaskCommentDTO(comment: TaskComment & { author: Profile }) {
  return {
    id: comment.id,
    taskId: comment.taskId,
    author: comment.author.fullName,
    authorId: comment.authorId,
    message: comment.message,
    createdAt: comment.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------

type AttendanceWithStaff = Attendance & { staff: Profile };

/**
 * Two call shapes:
 *  - a real Attendance row (`record` set) -> maps it directly.
 *  - a synthesized ABSENT entry for a staff member with no row for the
 *    requested day (`record` null, `staffOverride` + `dateOverride` set)
 *    -> see attendance.service.ts's `listAbsentees`.
 */
export function toAttendanceDTO(record: AttendanceWithStaff | null, staffOverride?: Profile, dateOverride?: Date) {
  const staff = record ? record.staff : (staffOverride as Profile);
  const date = record ? record.date : (dateOverride as Date);
  const dateKey = date.toISOString().slice(0, 10);

  return {
    id: record ? record.id : `absent-${staff.id}-${dateKey}`,
    staffId: staff.id,
    staffName: staff.fullName,
    employeeId: staff.employeeId ?? '',
    department: staff.department ?? '',
    date: dateKey,
    loginTime: record?.loginTime ? record.loginTime.toISOString() : null,
    logoutTime: record?.logoutTime ? record.logoutTime.toISOString() : null,
    totalWorkingMinutes: record?.totalWorkingMinutes ?? null,
    status: record ? record.status : ('ABSENT' as const),
  };
}

// ---------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------

type ActivityLogWithUser = ActivityLog & { user: Pick<Profile, 'fullName' | 'role'> };

export function toActivityLogDTO(entry: ActivityLogWithUser) {
  return {
    id: entry.id,
    userId: entry.userId,
    userName: entry.user.fullName,
    userRole: entry.user.role,
    action: entry.action,
    description: entry.description,
    entityType: entry.entityType,
    entityId: entry.entityId,
    ipAddress: entry.ipAddress,
    createdAt: entry.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------
// Signup / Admin creation requests
// ---------------------------------------------------------------------

type SignupRequestWithRelations = StaffSignupRequest & {
  reviewedBy: Profile | null;
  profile: Profile | null;
};

export function toSignupRequestDTO(request: SignupRequestWithRelations) {
  return {
    id: request.id,
    name: request.fullName,
    email: request.email,
    phone: request.phone ?? '',
    employeeId: request.profile?.employeeId ?? '',
    status: request.status,
    submittedAt: request.createdAt.toISOString(),
    reviewedBy: request.reviewedBy ? request.reviewedBy.fullName : null,
    reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
  };
}

type AdminRequestWithRelations = AdminCreationRequest & {
  requestedBy: Profile;
  reviewedBy: Profile | null;
};

export function toAdminRequestDTO(request: AdminRequestWithRelations) {
  return {
    id: request.id,
    name: request.fullName,
    email: request.email,
    status: request.status,
    requestedBy: request.requestedBy.fullName,
    requestedById: request.requestedById,
    submittedAt: request.createdAt.toISOString(),
    reviewedBy: request.reviewedBy ? request.reviewedBy.fullName : null,
    reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
    rejectionReason: request.rejectionReason,
  };
}

type AdminSignupRequestWithRelations = AdminSignupRequest & {
  reviewedBy: Profile | null;
  profile: Profile | null;
};

export function toAdminSignupRequestDTO(request: AdminSignupRequestWithRelations) {
  return {
    id: request.id,
    name: request.fullName,
    email: request.email,
    status: request.status,
    emailVerified: request.emailVerifiedAt !== null,
    submittedAt: request.createdAt.toISOString(),
    reviewedBy: request.reviewedBy ? request.reviewedBy.fullName : null,
    reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
    rejectionReason: request.rejectionReason,
  };
}

// ---------------------------------------------------------------------
// Notifications / Messages
// ---------------------------------------------------------------------

export function toNotificationDTO(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    entityType: notification.entityType,
    entityId: notification.entityId,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
  };
}

export function toMessageDTO(message: Message) {
  return {
    id: message.id,
    senderId: message.senderId,
    receiverId: message.receiverId,
    taskId: message.taskId,
    message: message.message,
    isRead: message.isRead,
    createdAt: message.createdAt.toISOString(),
  };
}
