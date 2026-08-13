import type { PresenceStatus, UserRole, UserStatus } from '@prisma/client';

export interface AuthUser {
  profileId: string;
  authUserId: string;
  role: UserRole;
  status: UserStatus;
  email: string;
  fullName: string;
  // Sourced from the same Profile row requireAuth already loads (see
  // auth.middleware.ts) — free to include, and lets handlers that need the
  // caller's own presence (e.g. GET /profile/status) skip a second,
  // otherwise-identical `profile.findUnique` for the same id.
  presenceStatus: PresenceStatus;
  lastActiveAt: Date | null;
}
