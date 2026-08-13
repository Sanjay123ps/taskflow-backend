import { z } from 'zod';

// OFFLINE is never accepted from the frontend — it's only ever set by the
// backend itself (on logout, or lazily after inactivity). See
// profile.service.ts.
export const updateStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'BUSY']),
});

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
