import { z } from 'zod';
import { idSchema } from './common';

export const invitationCreateRequestSchema = z.object({
  projectId: idSchema,
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  role: z.enum(['admin', 'member', 'viewer']).optional(),
});

export const invitationJoinRequestSchema = z.object({
  inviteToken: z.string().uuid(),
});
