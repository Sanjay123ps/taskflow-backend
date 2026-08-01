import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

/**
 * Must run after `requireAuth`. Rejects the request unless req.authUser's
 * role is one of `roles`. Never trusts a role claimed by the frontend —
 * the role always comes from the profile row loaded in requireAuth.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.authUser) {
      throw new UnauthorizedError();
    }
    if (!roles.includes(req.authUser.role)) {
      throw new ForbiddenError("You don't have permission to do that.");
    }
    next();
  };
}

export const requireAdmin = requireRole('ADMIN');
export const requireStaff = requireRole('STAFF');
