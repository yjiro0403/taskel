import { getDb } from '@/lib/firebaseAdmin';
import * as admin from 'firebase-admin';
import { PLAN_LIMITS } from './plans';
import type { PlanId, MonthlyUsageDoc } from './types';

function getCurrentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').filter(Boolean);

/**
 * ユーザーのクォータをチェック
 */
export async function checkQuota(userId: string): Promise<{
  allowed: boolean;
  plan: PlanId;
  used: number;
  limit: number;
}> {
  if (ADMIN_UIDS.includes(userId)) {
    return { allowed: true, plan: 'business', used: 0, limit: Infinity };
  }

  const db = getDb();
  const monthKey = getCurrentMonthKey();

  const [userSnap, usageSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('usage').doc(userId).collection('monthly').doc(monthKey).get(),
  ]);

  const plan: PlanId = userSnap.data()?.plan || 'free';
  const used: number = (usageSnap.data() as MonthlyUsageDoc | undefined)?.requestCount || 0;
  const limit = PLAN_LIMITS[plan].monthlyRequestLimit;

  return {
    allowed: used < limit,
    plan,
    used,
    limit,
  };
}

/**
 * リクエストカウントをインクリメント
 */
export async function incrementRequestCount(userId: string): Promise<void> {
  const db = getDb();
  const monthKey = getCurrentMonthKey();
  const ref = db.collection('usage').doc(userId).collection('monthly').doc(monthKey);

  await ref.set(
    {
      requestCount: admin.firestore.FieldValue.increment(1),
      lastRequestAt: Date.now(),
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

/**
 * トークン使用量を記録（fire-and-forget）
 */
export function recordTokenUsage(
  userId: string,
  inputTokens: number,
  outputTokens: number
): void {
  const db = getDb();
  const monthKey = getCurrentMonthKey();
  const ref = db.collection('usage').doc(userId).collection('monthly').doc(monthKey);

  ref.set(
    {
      totalInputTokens: admin.firestore.FieldValue.increment(inputTokens),
      totalOutputTokens: admin.firestore.FieldValue.increment(outputTokens),
      totalTokens: admin.firestore.FieldValue.increment(inputTokens + outputTokens),
      updatedAt: Date.now(),
    },
    { merge: true }
  ).catch((err) => {
    console.error('Failed to record token usage:', err);
  });
}
