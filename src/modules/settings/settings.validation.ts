import { z } from 'zod';

export const generalSettingsSchema = z.object({
  companyName: z.string().min(1),
  companyLogo: z.string().url().nullable(),
  timezone: z.string().min(1),
  dateFormat: z.string().min(1),
});

export const accountSettingsSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(5).nullable().optional(),
  profileImage: z.string().url().nullable(),
  // Staff-only in practice (Admin has no department/designation/joining
  // date of their own) — optional so Admin's existing calls to this same
  // endpoint keep working unchanged.
  department: z.string().min(1).nullable().optional(),
  designation: z.string().min(1).nullable().optional(),
  joiningDate: z.string().min(1).nullable().optional(),
});

export const taskSettingsSchema = z.object({
  defaultPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
});

export const notificationPreferencesSchema = z.object({
  taskAssignment: z.boolean(),
  taskCompletion: z.boolean(),
  reminders: z.boolean(),
});

export type GeneralSettingsInput = z.infer<typeof generalSettingsSchema>;
export type AccountSettingsInput = z.infer<typeof accountSettingsSchema>;
export type TaskSettingsInput = z.infer<typeof taskSettingsSchema>;
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
