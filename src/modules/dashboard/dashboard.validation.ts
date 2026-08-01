import { z } from 'zod';

export const dashboardQuerySchema = z.object({
  range: z.enum(['today', 'week', 'month', 'custom']).default('week'),
});

export type DashboardQueryInput = z.infer<typeof dashboardQuerySchema>;
