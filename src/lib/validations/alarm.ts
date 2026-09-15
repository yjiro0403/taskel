import { z } from 'zod';
import { idSchema } from './common';

export const alarmStatusSchema = z.enum(['scheduled', 'fired', 'dismissed']);

// fireAt は epoch ms（アプリ内の timestamp 規約に合わせる）。API 側で timestamptz へ変換する。
const fireAtSchema = z.number().int().nonnegative();

export const alarmCreateSchema = z.object({
  taskId: idSchema.nullable().optional(),
  label: z.string().trim().min(1).max(200).nullable().optional(),
  fireAt: fireAtSchema,
  snoozeMinutes: z.number().int().min(1).max(60).optional(),
});

export const alarmUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).nullable().optional(),
    fireAt: fireAtSchema.optional(),
    snoozeMinutes: z.number().int().min(1).max(60).optional(),
    status: alarmStatusSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    { message: 'At least one field is required' }
  );

export const deviceTokenUpsertSchema = z.object({
  fcmToken: z.string().trim().min(1).max(4096),
  deviceName: z.string().trim().min(1).max(200).nullable().optional(),
});
