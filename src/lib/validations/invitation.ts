import { z } from 'zod';
import { hubRoleSchema, idSchema } from './common';

export const invitationCreateRequestSchema = z.object({
  projectId: idSchema,
  email: z.string().email().optional(),
  role: hubRoleSchema.optional(),
});

export const invitationJoinRequestSchema = z.object({
  inviteToken: z.string().uuid(),
});

export const sendInvitationEmailSchema = z.object({
  email: z.string().email(),
  projectTitle: z.string().trim().min(1).max(200),
  inviterName: z.string().trim().min(1).max(100),
  inviteLink: z.string().url(),
});
