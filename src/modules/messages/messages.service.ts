import { prisma } from '../../config/prisma';
import { toMessageDTO } from '../../utils/dto';
import { buildPaginatedResult, normalizePagination } from '../../utils/pagination';
import { ForbiddenError, NotFoundError } from '../../utils/errors';
import { createNotification } from '../notifications/notifications.service';
import type { AuthUser } from '../../types/authUser';
import type { SendMessageInput, ThreadQueryInput } from './messages.validation';

/**
 * Messaging is scoped to Admin<->Staff conversations only (per spec), not
 * staff-to-staff or admin-to-admin.
 */
export async function sendMessage(input: SendMessageInput, sender: AuthUser) {
  const receiver = await prisma.profile.findUnique({ where: { id: input.receiverId } });
  if (!receiver || receiver.status !== 'ACTIVE') {
    throw new NotFoundError('Recipient not found or inactive');
  }

  const validPair =
    (sender.role === 'ADMIN' && receiver.role === 'STAFF') || (sender.role === 'STAFF' && receiver.role === 'ADMIN');
  if (!validPair) {
    throw new ForbiddenError('Messaging is only supported between Admin and Staff accounts.');
  }

  const message = await prisma.message.create({
    data: { senderId: sender.profileId, receiverId: input.receiverId, taskId: input.taskId, message: input.message },
  });

  await createNotification({
    userId: receiver.id,
    type: 'NEW_MESSAGE',
    title: `New message from ${sender.fullName}`,
    message: input.message.length > 120 ? `${input.message.slice(0, 117)}...` : input.message,
    entityType: 'Message',
    entityId: message.id,
  });

  return toMessageDTO(message);
}

export async function listConversations(authUser: AuthUser) {
  const messages = await prisma.message.findMany({
    where: { OR: [{ senderId: authUser.profileId }, { receiverId: authUser.profileId }] },
    orderBy: { createdAt: 'desc' },
    include: { sender: true, receiver: true },
  });

  const conversations = new Map<
    string,
    { partnerId: string; partnerName: string; lastMessage: ReturnType<typeof toMessageDTO>; unreadCount: number }
  >();

  for (const m of messages) {
    const partner = m.senderId === authUser.profileId ? m.receiver : m.sender;
    const existing = conversations.get(partner.id);
    const isUnreadForMe = m.receiverId === authUser.profileId && !m.isRead;
    if (!existing) {
      conversations.set(partner.id, {
        partnerId: partner.id,
        partnerName: partner.fullName,
        lastMessage: toMessageDTO(m),
        unreadCount: isUnreadForMe ? 1 : 0,
      });
    } else if (isUnreadForMe) {
      existing.unreadCount += 1;
    }
  }

  return Array.from(conversations.values());
}

export async function getThread(otherUserId: string, authUser: AuthUser, params: ThreadQueryInput) {
  const pagination = normalizePagination(params);
  const where = {
    OR: [
      { senderId: authUser.profileId, receiverId: otherUserId },
      { senderId: otherUserId, receiverId: authUser.profileId },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.message.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.take }),
    prisma.message.count({ where }),
  ]);

  await prisma.message.updateMany({
    where: { senderId: otherUserId, receiverId: authUser.profileId, isRead: false },
    data: { isRead: true },
  });

  return buildPaginatedResult(rows.map(toMessageDTO).reverse(), total, pagination);
}
