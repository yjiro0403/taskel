import { createClient } from '@/lib/supabase/server';
import { PLAN_LIMITS } from './plans';
import type { PlanId } from './types';

function getCurrentMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').filter(Boolean);

export async function checkQuota(userId: string): Promise<{
  allowed: boolean;
  plan: PlanId;
  used: number;
  limit: number;
}> {
  if (ADMIN_UIDS.includes(userId)) {
    return { allowed: true, plan: 'business', used: 0, limit: Infinity };
  }

  const supabase = await createClient();
  const month = getCurrentMonthStart();

  const [{ data: subscription }, { data: usage }] = await Promise.all([
    supabase.from('subscriptions').select('plan').eq('user_id', userId).maybeSingle(),
    supabase.from('usage_monthly').select('ai_messages_count').eq('user_id', userId).eq('month', month).maybeSingle(),
  ]);

  const plan: PlanId = (subscription?.plan as PlanId | null) || 'free';
  const used = usage?.ai_messages_count || 0;
  const limit = PLAN_LIMITS[plan].monthlyRequestLimit;

  return {
    allowed: used < limit,
    plan,
    used,
    limit,
  };
}

export async function incrementRequestCount(userId: string): Promise<void> {
  const supabase = await createClient();
  const month = getCurrentMonthStart();

  const { data: usage } = await supabase
    .from('usage_monthly')
    .select('ai_messages_count, ai_messages_limit')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();

  await supabase.from('usage_monthly').upsert({
    user_id: userId,
    month,
    ai_messages_count: (usage?.ai_messages_count || 0) + 1,
    ai_messages_limit: usage?.ai_messages_limit || 0,
  });
}

export function recordTokenUsage(
  _userId: string,
  _inputTokens: number,
  _outputTokens: number
): void {
  // usage_monthly currently stores request counts only.
}
