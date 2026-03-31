import { z } from 'zod';
import { dateSchema } from '@/lib/validations/common';

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

export const aiChatRequestSchema = z.object({
  messages: z.array(z.any()).min(1),
  currentDate: dateSchema.optional(),
  sections: z.array(z.any()).optional(),
  model: allowedModelSchema.optional(),
  activeGoals: z.array(goalSummarySchema).optional(),
  calibrationHint: calibrationHintSchema.optional(),
});

export const billingCheckoutRequestSchema = z.object({
  priceId: z.string().trim().min(1),
});
