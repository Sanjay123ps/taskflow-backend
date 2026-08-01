import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toNotificationDTO } from '../../utils/dto';
import { buildPaginatedResult, normalizePagination } from '../../utils/pagination';
import { NotFoundError } from '../../utils/errors';
import type { NotificationsQueryInput } from './notifications.validation';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

/** Fire-and-forget style creator, reused by tasks/signup/admin-request modules. */
export async function createNotification(
  input: CreateNotificationInput,
  client: Prisma.TransactionClient | PrismaClient = prisma,
) {
  return client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });
}

export async function listNotifications(userId: string, params: NotificationsQueryInput) {
  const pagination = normalizePagination(params);
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(params.unreadOnly ? { isRead: false } : {}),
  };

  const [rows, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return { ...buildPaginatedResult(rows.map(toNotificationDTO), total, pagination), unreadCount };
}

export async function markNotificationRead(id: string, userId: string) {
  const notification = await prisma.notification.findFirst({ where: { id, userId } });
  if (!notification) throw new NotFoundError('Notification not found');

  const updated = await prisma.notification.update({ where: { id }, data: { isRead: true } });
  return toNotificationDTO(updated);
}

export async function markAllNotificationsRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
}
