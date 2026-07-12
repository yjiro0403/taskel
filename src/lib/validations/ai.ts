import { z } from 'zod';
import { dateSchema } from './common';

const allowedModelSchema = z.enum([
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-3-flash',
  'gemini-2.5-pro',
  'gemini-3-pro',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
]);

const goalSummarySchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  type: z.enum(['yearly', 'monthly', 'weekly']),
  status: z.enum(['pending', 'in_progress', 'achieved', 'missed', 'cancelled']),
  progress: z.number(),
  assignedYear: z.string().trim().min(1),
  assignedMonth: z.string().trim().min(1).optional(),
  assignedWeek: z.string().trim().min(1).optional(),
  parentGoalId: z.string().trim().min(1).optional(),
  linkedTaskCount: z.number().int().nonnegative(),
  aiSuggestedBreakdown: z.array(z.string()).optional(),
  keyResults: z.array(z.string()).optional(),
});

const calibrationHintSchema = z.object({
  accuracyRatio: z.number(),
  averageDeviationPercent: z.number(),
  sampleSize: z.number().int().nonnegative(),
});

const aiMessagePartSchema = z.object({
  text: z.string().optional(),
}).passthrough();

const aiMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().trim().min(1).optional(),
  parts: z.array(aiMessagePartSchema).optional(),
}).refine(
  (message) => {
    if (message.content && message.content.trim().length > 0) {
      return true;
    }

    return (message.parts ?? []).some(
      (part) => typeof part.text === 'string' && part.text.trim().length > 0
    );
  },
  {
    message: 'Message must include content or at least one text part.',
  }
);

const aiSectionSchema = z.object({
  id: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  order: z.number(),
});

export const aiChatRequestSchema = z.object({
  messages: z.array(aiMessageSchema).min(1),
  currentDate: dateSchema.optional(),
  sections: z.array(aiSectionSchema).optional(),
  model: allowedModelSchema.optional(),
  activeGoals: z.array(goalSummarySchema).optional(),
  calibrationHint: calibrationHintSchema.optional(),
});

export const billingCheckoutRequestSchema = z.object({
  priceId: z.string().trim().min(1),
});
