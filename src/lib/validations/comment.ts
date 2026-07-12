import { z } from 'zod';

export const commentCreateSchema = z.object({
  content: z.string().trim().min(1).max(10000),
  authorName: z.string().trim().min(1).max(100).optional(),
});
