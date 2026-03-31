import { z } from 'zod';

export const idSchema = z.string().trim().min(1);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);
export const hubRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export const taskStatusSchema = z.enum(['open', 'in_progress', 'done', 'skipped']);

export const attachmentSchema = z.object({
  id: idSchema,
  url: z.string().url(),
  path: z.string().trim().min(1),
  name: z.string().trim().min(1).max(255),
  type: z.enum(['image', 'file']),
  size: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
});
