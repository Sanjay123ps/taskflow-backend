import type { ActivityAction, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { normalizePagination, buildPaginatedResult, type PaginationInput } from '../../utils/pagination';
import { toActivityLogDTO } from '../../utils/dto';

export interface LogActivityInput {
  userId: string;
  action: ActivityAction;
  description: string;
  entityType?: string;
  entityId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Activity logs are append-only: this is the only write path into the
 * table anywhere in the codebase, and there is deliberately no
 * update/delete exposed for it.
 */
export async function logActivity(
  input: LogActivityInput,
  client: Prisma.TransactionClient | PrismaClient = prisma,
) {
  await client.activityLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      description: input.description,
      entityType: input.entityType,
      entityId: input.entityId,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
    },
  });
}

export interface ActivityQueryParams extends PaginationInput {
  action?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function listActivity(params: ActivityQueryParams) {
  const pagination = normalizePagination(params);

  const where: Prisma.ActivityLogWhereInput = {
    ...(params.action && params.action !== 'ALL' ? { action: params.action as ActivityAction } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.dateFrom || params.dateTo
      ? {
          createdAt: {
            ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
            ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: { user: { select: { fullName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return buildPaginatedResult(rows.map(toActivityLogDTO), total, pagination);
}
