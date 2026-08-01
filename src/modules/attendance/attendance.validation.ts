import { z } from 'zod';

const statusEnum = z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'INCOMPLETE']);

export const attendanceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  staffId: z.string().uuid().optional(),
  department: z.string().optional(),
  status: z.union([statusEnum, z.literal('ALL')]).optional(),
  // Exact-day filter. Takes precedence over dateFrom/dateTo when present.
  date: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().trim().optional(),
});

export const attendanceIdParamSchema = z.object({ id: z.string().uuid() });
export const staffIdParamSchema = z.object({ staffId: z.string().uuid() });

export type AttendanceQueryInput = z.infer<typeof attendanceQuerySchema>;
