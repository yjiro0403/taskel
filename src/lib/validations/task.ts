import { z } from 'zod';
import {
  attachmentSchema,
  dateSchema,
  idSchema,
  taskStatusSchema,
} from './common';

const nullableString = z.string().trim().min(1).nullable().optional();

const taskCreateSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(200),
  sectionId: idSchema,
  date: dateSchema,
  status: taskStatusSchema,
  estimatedMinutes: z.number().int().min(0).max(24 * 60),
  actualMinutes: z.number().int().min(0).max(24 * 60),
  order: z.number(),
  assigneeId: nullableString,
  reporterId: nullableString,
  startedAt: z.number().int().nonnegative().optional(),
  completedAt: z.number().int().nonnegative().optional(),
  scheduledStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  externalLink: z.string().url().optional(),
  parentGoalId: nullableString,
  aiTags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  projectId: nullableString,
  milestoneId: nullableString,
  routineId: nullableString,
  assignedWeek: z.string().trim().min(1).max(20).optional(),
  assignedMonth: z.string().trim().min(1).max(20).optional(),
  assignedYear: z.string().trim().min(1).max(10).optional(),
  assignedDate: dateSchema.optional(),
  score: z.number().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  memo: z.string().max(10000).optional(),
  attachments: z.array(attachmentSchema).max(20).optional(),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  aiStatus: z.enum(['pending', 'processing', 'completed', 'error']).optional(),
  aiError: z.string().max(1000).optional(),
  aiCompletedAt: z.number().int().nonnegative().optional(),
  commentCount: z.number().int().nonnegative().optional(),
});

const taskUpdateSchema = taskCreateSchema
  .partial()
  .extend({
    id: idSchema,
  });

export const taskMutationRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    task: taskCreateSchema,
  }),
  z.object({
    action: z.literal('update'),
    task: taskUpdateSchema,
  }),
]);

export const taskIdRequestSchema = z.object({
  taskId: idSchema,
});
