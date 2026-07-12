import { z } from 'zod';
import { dateSchema, hubRoleSchema, idSchema } from './common';

export const projectSchema = z.object({
  id: idSchema,
  userId: idSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  ownerId: idSchema,
  memberIds: z.array(idSchema).min(1),
  roles: z.record(idSchema, hubRoleSchema).optional(),
  status: z.enum(['active', 'completed', 'archived']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  milestones: z
    .array(
      z.object({
        id: idSchema,
        title: z.string().trim().min(1).max(200),
        description: z.string().max(5000).optional(),
        startDate: dateSchema.optional(),
        endDate: dateSchema.optional(),
        order: z.number(),
        status: z.enum(['open', 'in_progress', 'done']),
      })
    )
    .optional(),
});

export const projectInviteRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['admin', 'member', 'viewer']).optional(),
});

export const userLookupRequestSchema = z.object({
  email: z.string().email(),
  projectId: idSchema,
});
