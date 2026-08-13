import { prisma } from '../../config/prisma';
import { supabaseAdmin } from '../../config/supabase';
import { hashRefreshToken } from '../../utils/tokens';
import { toAdminProfileDTO, toStaffMemberDTO } from '../../utils/dto';
import { logActivity } from '../activities/activity.service';
import { ConflictError } from '../../utils/errors';
import type { AuthUser } from '../../types/authUser';
import type {
  AccountSettingsInput,
  GeneralSettingsInput,
  NotificationPreferencesInput,
  TaskSettingsInput,
} from './settings.validation';

const GENERAL_SETTINGS_KEY = 'general';
const TASK_SETTINGS_KEY = 'taskDefaults';
const notificationPreferencesKey = (profileId: string) => `notificationPreferences:${profileId}`;

const DEFAULT_GENERAL_SETTINGS: GeneralSettingsInput = {
  companyName: 'TaskFlow',
  companyLogo: null,
  timezone: 'UTC',
  dateFormat: 'MM/DD/YYYY',
};

const DEFAULT_TASK_SETTINGS: TaskSettingsInput = { defaultPriority: 'MEDIUM' };

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesInput = {
  taskAssignment: true,
  taskCompletion: true,
  reminders: true,
};

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

async function setSetting<T>(key: string, value: T, updatedById: string): Promise<T> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as object, updatedById },
    update: { value: value as object, updatedById },
  });
  await logActivity({
    userId: updatedById,
    action: 'SETTINGS_UPDATED',
    description: `Updated ${key} settings`,
    entityType: 'SystemSetting',
    entityId: key,
  });
  return value;
}

export function getGeneralSettings() {
  return getSetting(GENERAL_SETTINGS_KEY, DEFAULT_GENERAL_SETTINGS);
}

export function updateGeneralSettings(input: GeneralSettingsInput, updatedById: string) {
  return setSetting(GENERAL_SETTINGS_KEY, input, updatedById);
}

export function getTaskSettings() {
  return getSetting(TASK_SETTINGS_KEY, DEFAULT_TASK_SETTINGS);
}

export function updateTaskSettings(input: TaskSettingsInput, updatedById: string) {
  return setSetting(TASK_SETTINGS_KEY, input, updatedById);
}

export async function updateAccountSettings(input: AccountSettingsInput, authUser: AuthUser) {
  // authUser.email / authUser.authUserId came from the profile row
  // requireAuth loaded for this exact request a moment ago, so there's no
  // need for a second `profile.findUniqueOrThrow` by the same id just to
  // read the same two fields back.
  //
  // Login and forgot-password both authenticate against Supabase Auth's
  // copy of the email, so writing a new email to Postgres without also
  // updating Supabase would silently lock the account out under its new
  // address. Sync first and bail out before touching Postgres if it fails.
  if (input.email !== authUser.email) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.authUserId, { email: input.email });
    if (error) {
      throw new ConflictError('Could not update email. Please try again.');
    }
  }

  const profile = await prisma.profile.update({
    where: { id: authUser.profileId },
    data: {
      fullName: input.name,
      email: input.email,
      phone: input.phone,
      profileImageUrl: input.profileImage,
      // Staff-only fields in practice — Admin's own calls to this endpoint
      // simply never send them, so they're skipped rather than nulled out.
      ...(input.department !== undefined ? { department: input.department } : {}),
      ...(input.designation !== undefined ? { designation: input.designation } : {}),
      ...(input.joiningDate !== undefined
        ? { joiningDate: input.joiningDate ? new Date(input.joiningDate) : null }
        : {}),
    },
  });

  await logActivity({
    userId: authUser.profileId,
    action: 'PROFILE_UPDATED',
    description: `${profile.fullName} updated their account settings`,
    entityType: 'Profile',
    entityId: profile.id,
  });

  return profile.role === 'ADMIN' ? toAdminProfileDTO(profile) : toStaffMemberDTO(profile);
}

export function getNotificationPreferences(profileId: string) {
  return getSetting(notificationPreferencesKey(profileId), DEFAULT_NOTIFICATION_PREFERENCES);
}

export function updateNotificationPreferences(input: NotificationPreferencesInput, profileId: string) {
  return setSetting(notificationPreferencesKey(profileId), input, profileId);
}

function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/mobile/i.test(userAgent)) return 'Mobile browser';
  if (/chrome/i.test(userAgent)) return 'Chrome';
  if (/firefox/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  if (/edg/i.test(userAgent)) return 'Edge';
  return 'Browser';
}

export async function listActiveSessions(authUser: AuthUser, rawRefreshToken: string | undefined) {
  const currentHash = rawRefreshToken ? hashRefreshToken(rawRefreshToken) : null;

  const sessions = await prisma.session.findMany({
    where: { userId: authUser.profileId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastActiveAt: 'desc' },
  });

  return sessions.map((s) => ({
    id: s.id,
    device: describeUserAgent(s.userAgent),
    ipAddress: s.ipAddress ?? 'Unknown',
    lastActiveAt: s.lastActiveAt.toISOString(),
    current: currentHash !== null && s.refreshTokenHash === currentHash,
  }));
}

export async function logoutAllSessions(authUser: AuthUser) {
  await prisma.session.updateMany({
    where: { userId: authUser.profileId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await logActivity({
    userId: authUser.profileId,
    action: authUser.role === 'ADMIN' ? 'ADMIN_LOGOUT' : 'STAFF_LOGOUT',
    description: `${authUser.fullName} signed out of all sessions`,
    entityType: 'Profile',
    entityId: authUser.profileId,
  });
}
