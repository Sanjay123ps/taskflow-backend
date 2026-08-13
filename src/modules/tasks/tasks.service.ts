import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toTaskCommentDTO, toTaskDTO } from '../../utils/dto';
import { buildPaginatedResult, normalizePagination } from '../../utils/pagination';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/errors';
import { logActivity } from '../activities/activity.service';
import { createNotification } from '../notifications/notifications.service';
import { uploadTaskAttachmentFile, deleteFromBucket, createSignedAttachmentUrl } from '../../utils/storage';
import { env } from '../../config/env';
import type { AuthUser } from '../../types/authUser';
import type { CreateTaskInput, TaskQueryInput, UpdateTaskInput } from './tasks.validation';

// `toTaskDTO` only ever reads assignedTo.{id,fullName,employeeId,profileImageUrl}
// and never reads `createdBy` at all (see utils/dto.ts) — the previous
// `{ assignedTo: true, createdBy: true }` pulled the *entire* Profile row
// for both relations on every task read, including a wholly unused
// `createdBy` join. Trimmed to just what's used.
export const taskInclude = {
  assignedTo: { select: { id: true, fullName: true, employeeId: true, profileImageUrl: true } },
} as const;

/**
 * Wraps `toTaskDTO` and swaps in a freshly-minted signed URL for
 * `attachmentUrl` (see storage.ts createSignedAttachmentUrl). Must only be
 * called after the caller has already been authorized to view this task —
 * every call site below (getTask, listTasks, createTask, updateTask,
 * addTaskAttachment) either performs that check itself or is only
 * reachable by an Admin.
 */
async function toTaskDTOWithSignedAttachment(task: Parameters<typeof toTaskDTO>[0]) {
  const dto = toTaskDTO(task);
  return { ...dto, attachmentUrl: await createSignedAttachmentUrl(task.attachmentPath) };
}

function scopeToRole(where: Prisma.TaskWhereInput, authUser: AuthUser): Prisma.TaskWhereInput {
  if (authUser.role === 'STAFF') {
    return { ...where, assignedToId: authUser.profileId };
  }
  return where;
}

export async function listTasks(params: TaskQueryInput, authUser: AuthUser) {
  // Overdue status is kept in sync by the background job started in
  // server.ts (see overdue.service.ts) instead of on every read here —
  // see that file for why an inline UPDATE on a GET path was removed.
  const pagination = normalizePagination(params);

  let where: Prisma.TaskWhereInput = {
    ...(params.staffId ? { assignedToId: params.staffId } : {}),
    ...(params.priority && params.priority !== 'ALL' ? { priority: params.priority } : {}),
    ...(params.status && params.status !== 'ALL' ? { status: params.status } : {}),
    ...(params.overdueOnly ? { status: 'OVERDUE' } : {}),
    ...(params.excludeCompleted ? { status: { not: 'COMPLETED' } } : {}),
    ...(params.dateFrom || params.dateTo
      ? {
          dueDate: {
            ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
            ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
          },
        }
      : {}),
    ...(params.search
      ? { OR: [{ title: { contains: params.search, mode: 'insensitive' } }, { description: { contains: params.search, mode: 'insensitive' } }] }
      : {}),
  };

  where = scopeToRole(where, authUser);

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.task.count({ where }),
  ]);

  // Pagination caps this at <= 100 rows (normalizePagination, see
  // utils/pagination.ts), and createSignedAttachmentUrl no-ops instantly
  // for the (usual) case of no attachment, so this stays bounded — it's
  // not the same class of unbounded fan-out the Phase 4 report caps guard
  // against.
  const dtos = await Promise.all(rows.map((task) => toTaskDTOWithSignedAttachment(task)));
  return buildPaginatedResult(dtos, total, pagination);
}

export async function getTask(id: string, authUser: AuthUser) {
  const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) throw new NotFoundError('Task not found');
  if (authUser.role === 'STAFF' && task.assignedToId !== authUser.profileId) {
    throw new ForbiddenError("You don't have permission to view this task.");
  }
  return toTaskDTOWithSignedAttachment(task);
}

export async function createTask(
  input: CreateTaskInput,
  file: Express.Multer.File | undefined,
  createdByProfileId: string,
) {
  const assignee = await prisma.profile.findFirst({ where: { id: input.assignedToId, role: 'STAFF', status: 'ACTIVE' } });
  if (!assignee) throw new NotFoundError('Assigned staff member not found or inactive');

  let attachment: { path: string; publicUrl: string } | null = null;
  if (file) {
    attachment = await uploadTaskAttachmentFile(file);
  }

  const task = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      assignedToId: input.assignedToId,
      createdById: createdByProfileId,
      priority: input.priority,
      status: 'PENDING',
      dueDate: new Date(input.dueDate),
      dueTime: input.dueTime,
      notes: input.notes,
      // No `attachmentUrl` write here on purpose (Phase 5): the bucket is
      // private now, so there is no durable public URL to store — only
      // the path is persisted, and a short-lived signed URL is minted at
      // read time by toTaskDTOWithSignedAttachment. See storage.ts.
      attachmentPath: attachment?.path,
    },
    include: taskInclude,
  });

  await logActivity({
    userId: createdByProfileId,
    action: 'TASK_CREATED',
    description: `Created task "${task.title}" and assigned it to ${assignee.fullName}`,
    entityType: 'Task',
    entityId: task.id,
  });

  await createNotification({
    userId: assignee.id,
    type: 'TASK_ASSIGNED',
    title: 'New task assigned',
    message: `You've been assigned "${task.title}", due ${input.dueDate}.`,
    entityType: 'Task',
    entityId: task.id,
  });

  return toTaskDTOWithSignedAttachment(task);
}

const STAFF_ALLOWED_FIELDS: ReadonlyArray<keyof UpdateTaskInput> = ['status'];
const STAFF_ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED'],
  OVERDUE: ['IN_PROGRESS', 'COMPLETED'],
  COMPLETED: [],
};

export async function updateTask(id: string, input: UpdateTaskInput, authUser: AuthUser) {
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Task not found');

  if (authUser.role === 'STAFF') {
    if (existing.assignedToId !== authUser.profileId) {
      throw new ForbiddenError("You don't have permission to update this task.");
    }
    const attemptedFields = Object.keys(input) as Array<keyof UpdateTaskInput>;
    const disallowed = attemptedFields.filter((field) => !STAFF_ALLOWED_FIELDS.includes(field));
    if (disallowed.length > 0) {
      throw new ForbiddenError(`Staff can only update: ${STAFF_ALLOWED_FIELDS.join(', ')}`);
    }
    if (input.status) {
      const allowedNext = STAFF_ALLOWED_STATUS_TRANSITIONS[existing.status] ?? [];
      if (!allowedNext.includes(input.status)) {
        throw new ForbiddenError(`Cannot move a task from ${existing.status} to ${input.status}`);
      }
    }
  }

  let assignee = null;
  if (input.assignedToId && input.assignedToId !== existing.assignedToId) {
    assignee = await prisma.profile.findFirst({ where: { id: input.assignedToId, role: 'STAFF', status: 'ACTIVE' } });
    if (!assignee) throw new NotFoundError('Assigned staff member not found or inactive');
  }

  const isCompleting = input.status === 'COMPLETED' && existing.status !== 'COMPLETED';
  const isReopening = input.status && input.status !== 'COMPLETED' && existing.status === 'COMPLETED';

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.dueDate !== undefined ? { dueDate: new Date(input.dueDate) } : {}),
      ...(input.dueTime !== undefined ? { dueTime: input.dueTime } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(isCompleting ? { completedAt: new Date() } : {}),
      ...(isReopening ? { completedAt: null } : {}),
    },
    include: taskInclude,
  });

  const action = isCompleting ? 'TASK_COMPLETED' : input.assignedToId ? 'TASK_ASSIGNED' : 'TASK_UPDATED';
  await logActivity({
    userId: authUser.profileId,
    action,
    description: isCompleting ? `Marked task "${task.title}" as completed` : `Updated task "${task.title}"`,
    entityType: 'Task',
    entityId: task.id,
  });

  if (assignee) {
    await createNotification({
      userId: assignee.id,
      type: 'TASK_ASSIGNED',
      title: 'Task reassigned to you',
      message: `"${task.title}" has been assigned to you.`,
      entityType: 'Task',
      entityId: task.id,
    });
  }

  if (isCompleting && task.createdById !== authUser.profileId) {
    await createNotification({
      userId: task.createdById,
      type: 'TASK_COMPLETED',
      title: 'Task completed',
      message: `"${task.title}" was marked completed by ${authUser.fullName}.`,
      entityType: 'Task',
      entityId: task.id,
    });
  }

  return toTaskDTOWithSignedAttachment(task);
}

export async function addTaskAttachment(id: string, file: Express.Multer.File | undefined, authUser: AuthUser) {
  if (!file) throw new BadRequestError('No file was uploaded.');

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Task not found');

  if (authUser.role === 'STAFF' && existing.assignedToId !== authUser.profileId) {
    throw new ForbiddenError("You don't have permission to upload attachments to this task.");
  }

  const attachment = await uploadTaskAttachmentFile(file);

  // Replacing an existing attachment: clean up the old file so the bucket
  // doesn't accumulate orphaned uploads.
  if (existing.attachmentPath) {
    await deleteFromBucket(env.TASK_ATTACHMENTS_BUCKET, existing.attachmentPath);
  }

  const task = await prisma.task.update({
    where: { id },
    // See createTask above: attachmentUrl is no longer written; only the
    // path is persisted, signed URLs are minted on read.
    data: { attachmentPath: attachment.path },
    include: taskInclude,
  });

  await logActivity({
    userId: authUser.profileId,
    action: 'TASK_UPDATED',
    description: `Uploaded an attachment to task "${task.title}"`,
    entityType: 'Task',
    entityId: task.id,
  });

  const notifyUserId = authUser.profileId === task.createdById ? task.assignedToId : task.createdById;
  if (notifyUserId) {
    await createNotification({
      userId: notifyUserId,
      type: 'TASK_ATTACHMENT_ADDED',
      title: 'New task attachment',
      message: `${authUser.fullName} added an attachment to "${task.title}".`,
      entityType: 'Task',
      entityId: task.id,
    });
  }

  return toTaskDTOWithSignedAttachment(task);
}

export async function deleteTask(id: string, deletedByProfileId: string) {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) throw new NotFoundError('Task not found');

  if (task.attachmentPath) {
    await deleteFromBucket(env.TASK_ATTACHMENTS_BUCKET, task.attachmentPath);
  }

  await prisma.task.delete({ where: { id } });

  await logActivity({
    userId: deletedByProfileId,
    action: 'TASK_DELETED',
    description: `Deleted task "${task.title}"`,
    entityType: 'Task',
    entityId: id,
  });
}

export async function addComment(taskId: string, message: string, authUser: AuthUser) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError('Task not found');
  if (authUser.role === 'STAFF' && task.assignedToId !== authUser.profileId) {
    throw new ForbiddenError("You don't have permission to comment on this task.");
  }

  const comment = await prisma.taskComment.create({
    data: { taskId, authorId: authUser.profileId, message },
    include: { author: { select: { fullName: true } } },
  });

  const notifyUserId = authUser.profileId === task.createdById ? task.assignedToId : task.createdById;
  if (notifyUserId) {
    await createNotification({
      userId: notifyUserId,
      type: 'TASK_COMMENT',
      title: 'New comment on a task',
      message: `${authUser.fullName} commented on "${task.title}".`,
      entityType: 'Task',
      entityId: task.id,
    });
  }

  return toTaskCommentDTO(comment);
}

export async function listComments(taskId: string, authUser: AuthUser) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError('Task not found');
  if (authUser.role === 'STAFF' && task.assignedToId !== authUser.profileId) {
    throw new ForbiddenError("You don't have permission to view this task.");
  }

  const comments = await prisma.taskComment.findMany({
    where: { taskId },
    include: { author: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return comments.map(toTaskCommentDTO);
}
