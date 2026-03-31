import { z } from 'zod';
import { dateSchema } from '@/lib/validations/common';

export const aiChatRequestSchema = z.object({
  messages: z.array(z.any()).min(1),
  currentDate: dateSchema.optional(),
  sections: z.array(z.any()).optional(),
  model: z.string().trim().min(1).optional(),
  activeGoals: z.any().optional(),
  calibrationHint: z.string().max(2000).optional(),
});

export const billingCheckoutRequestSchema = z.object({
  priceId: z.string().trim().min(1),
});
