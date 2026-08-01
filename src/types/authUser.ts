import type { UserRole, UserStatus } from '@prisma/client';

export interface AuthUser {
  profileId: string;
  authUserId: string;
  role: UserRole;
  status: UserStatus;
  email: string;
  fullName: string;
}
