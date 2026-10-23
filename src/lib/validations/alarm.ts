import { z } from 'zod';
import { idSchema } from './common';

export const alarmStatusSchema = z.enum(['scheduled', 'fired', 'dismissed']);

// fireAt は epoch ms（アプリ内の timestamp 規約に合わせる）。API 側で timestamptz へ変換する。
const fireAtSchema = z.number().int().nonnegative();
// タスク開始時刻の何分前か。null = 絶対時刻指定へ戻す。上限は DB 制約と揃える。
const offsetMinutesSchema = z.number().int().min(0).max(40320);

export const alarmCreateSchema = z.object({
  taskId: idSchema.nullable().optional(),
  label: z.string().trim().min(1).max(200).nullable().optional(),
  fireAt: fireAtSchema,
  offsetMinutes: offsetMinutesSchema.nullable().optional(),
  snoozeMinutes: z.number().int().min(1).max(60).optional(),
});

export const alarmUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).nullable().optional(),
    fireAt: fireAtSchema.optional(),
    offsetMinutes: offsetMinutesSchema.nullable().optional(),
    snoozeMinutes: z.number().int().min(1).max(60).optional(),
    status: alarmStatusSchema.optional(),
    /** 端末の WebView 書き戻し専用。true のとき、scheduled のまま鳴動中にする。 */
    ringing: z.literal(true).optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    { message: 'At least one field is required' }
  );

export const deviceTokenUpsertSchema = z.object({
  fcmToken: z.string().trim().min(1).max(4096),
  deviceName: z.string().trim().min(1).max(200).nullable().optional(),
  /** 端末が鳴動報告に使う秘密。サーバーは SHA-256 だけを保存する。 */
  deviceSecret: z.string().trim().min(32).max(200).optional(),
});

export const deviceAlarmReportSchema = z.object({
  alarmId: idSchema,
  action: z.enum(['ring', 'dismiss', 'snooze']),
  fireAt: z.number().int().nonnegative().optional(),
});
