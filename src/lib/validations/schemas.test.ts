import { describe, expect, it } from 'vitest';

import { aiChatRequestSchema, billingCheckoutRequestSchema } from './ai';
import { commentCreateSchema } from './comment';
import {
  attachmentSchema,
  dateSchema,
  hubRoleSchema,
  idSchema,
  taskStatusSchema,
  timeSchema,
} from './common';
import {
  invitationCreateRequestSchema,
  invitationJoinRequestSchema,
  sendInvitationEmailSchema,
} from './invitation';
import {
  projectInviteRequestSchema,
  projectSchema,
  userLookupRequestSchema,
} from './project';
import { taskIdRequestSchema, taskMutationRequestSchema } from './task';

describe('validation schemas', () => {
  it('validates common schemas for valid and invalid values', () => {
    expect(idSchema.safeParse('task-1').success).toBe(true);
    expect(idSchema.safeParse('   ').success).toBe(false);
    expect(dateSchema.safeParse('2026-04-11').success).toBe(true);
    expect(dateSchema.safeParse('04/11/2026').success).toBe(false);
    expect(timeSchema.safeParse('09:30').success).toBe(true);
    expect(timeSchema.safeParse('9:30').success).toBe(false);
    expect(hubRoleSchema.safeParse('admin').success).toBe(true);
    expect(hubRoleSchema.safeParse('guest').success).toBe(false);
    expect(taskStatusSchema.safeParse('done').success).toBe(true);
    expect(taskStatusSchema.safeParse('archived').success).toBe(false);
    expect(
      attachmentSchema.safeParse({
        id: 'att-1',
        url: 'https://example.com/file.png',
        path: 'attachments/file.png',
        name: 'file.png',
        type: 'image',
        size: 42,
        createdAt: 1,
      }).success
    ).toBe(true);
    expect(
      attachmentSchema.safeParse({
        id: 'att-1',
        url: 'not-a-url',
        path: '',
        name: '',
        type: 'other',
        createdAt: -1,
      }).success
    ).toBe(false);
  });

  it('validates AI request schemas with concrete message and section shapes', () => {
    const valid = aiChatRequestSchema.safeParse({
      messages: [
        { role: 'user', content: 'Plan my day' },
        { role: 'assistant', parts: [{ text: 'Sure' }] },
      ],
      currentDate: '2026-04-11',
      sections: [{ id: 's1', userId: 'user-1', name: 'Morning', startTime: '06:00', order: 0 }],
      model: 'gemini-2.5-flash',
      activeGoals: [{
        id: 'goal-1',
        title: 'Ship P2',
        type: 'weekly',
        status: 'in_progress',
        progress: 50,
        assignedYear: '2026',
        linkedTaskCount: 3,
      }],
      calibrationHint: {
        accuracyRatio: 0.9,
        averageDeviationPercent: 12,
        sampleSize: 5,
      },
    });

    expect(valid.success).toBe(true);
    expect(aiChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: '   ' }],
    }).success).toBe(false);
    expect(aiChatRequestSchema.safeParse({
      messages: [{ role: 'tool', content: 'x' }],
    }).success).toBe(false);
    expect(aiChatRequestSchema.safeParse({
      messages: [{ role: 'assistant', parts: [{}] }],
      sections: [{ id: 's1', name: 'Morning', startTime: '6:00', order: 0 }],
    }).success).toBe(false);

    expect(billingCheckoutRequestSchema.safeParse({ priceId: 'price_123' }).success).toBe(true);
    expect(billingCheckoutRequestSchema.safeParse({ priceId: '' }).success).toBe(false);
  });

  it('validates invitation schemas for valid and invalid payloads', () => {
    expect(invitationCreateRequestSchema.safeParse({
      projectId: 'project-1',
      email: 'user@example.com',
      role: 'member',
    }).success).toBe(true);
    expect(invitationCreateRequestSchema.safeParse({
      projectId: '',
      email: 'bad-email',
      role: 'guest',
    }).success).toBe(false);

    expect(invitationJoinRequestSchema.safeParse({
      inviteToken: '550e8400-e29b-41d4-a716-446655440000',
    }).success).toBe(true);
    expect(invitationJoinRequestSchema.safeParse({ inviteToken: 'token' }).success).toBe(false);

    expect(sendInvitationEmailSchema.safeParse({
      email: 'user@example.com',
      projectTitle: 'Taskel',
      inviterName: 'Owner',
      inviteLink: 'https://example.com/join',
    }).success).toBe(true);
    expect(sendInvitationEmailSchema.safeParse({
      email: 'bad',
      projectTitle: '',
      inviterName: '',
      inviteLink: 'invalid',
    }).success).toBe(false);
  });

  it('validates project schemas for valid and invalid payloads', () => {
    expect(projectSchema.safeParse({
      id: 'project-1',
      userId: 'user-1',
      title: 'Migration',
      description: 'Supabase',
      ownerId: 'user-1',
      memberIds: ['user-1'],
      roles: { 'user-1': 'owner' },
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
      milestones: [{
        id: 'milestone-1',
        title: 'Phase 1',
        order: 0,
        status: 'open',
      }],
    }).success).toBe(true);
    expect(projectSchema.safeParse({
      id: '',
      userId: 'user-1',
      title: '',
      description: 'x',
      ownerId: 'user-1',
      memberIds: [],
      status: 'paused',
      createdAt: -1,
      updatedAt: -1,
    }).success).toBe(false);

    expect(projectInviteRequestSchema.safeParse({ email: 'user@example.com', role: 'viewer' }).success).toBe(true);
    expect(projectInviteRequestSchema.safeParse({ email: 'bad-email', role: 'guest' }).success).toBe(false);
    expect(userLookupRequestSchema.safeParse({ email: 'user@example.com', projectId: 'project-1' }).success).toBe(true);
    expect(userLookupRequestSchema.safeParse({ email: 'bad', projectId: '' }).success).toBe(false);
  });

  it('validates comment and task schemas for valid and invalid payloads', () => {
    expect(commentCreateSchema.safeParse({ content: 'Looks good', authorName: 'Alice' }).success).toBe(true);
    expect(commentCreateSchema.safeParse({ content: '', authorName: '' }).success).toBe(false);

    const createTaskPayload = {
      action: 'create',
      task: {
        id: 'task-1',
        title: 'Write tests',
        sectionId: 'section-1',
        date: '2026-04-11',
        status: 'open',
        estimatedMinutes: 30,
        actualMinutes: 0,
        order: 1,
        attachments: [{
          id: 'att-1',
          url: 'https://example.com/file.png',
          path: 'attachments/file.png',
          name: 'file.png',
          type: 'image',
          createdAt: 1,
        }],
      },
    };

    expect(taskMutationRequestSchema.safeParse(createTaskPayload).success).toBe(true);
    expect(taskMutationRequestSchema.safeParse({
      action: 'update',
      task: { id: 'task-1', status: 'done' },
    }).success).toBe(true);
    expect(taskMutationRequestSchema.safeParse({
      action: 'create',
      task: {
        ...createTaskPayload.task,
        title: '',
        estimatedMinutes: -1,
      },
    }).success).toBe(false);
    expect(taskIdRequestSchema.safeParse({ taskId: 'task-1' }).success).toBe(true);
    expect(taskIdRequestSchema.safeParse({ taskId: '' }).success).toBe(false);
  });
});
