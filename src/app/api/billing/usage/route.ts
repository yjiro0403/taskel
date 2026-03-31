import { NextResponse } from 'next/server';
import { PLAN_LIMITS } from '@/lib/billing/plans';
import type { PlanId, SubscriptionStatus } from '@/lib/billing/types';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const uid = user.id;

    const supabase = await createClient();
    const now = new Date();
    const monthKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

    const [subscriptionRes, usageRes] = await Promise.all([
      supabase.from('subscriptions').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('usage_monthly').select('*').eq('user_id', uid).eq('month', monthKey).maybeSingle(),
    ]);

    const subData = subscriptionRes.data;
    const usageData = usageRes.data;
    const plan: PlanId = (subData?.plan as PlanId | null) || 'free';
    const subscriptionStatus: SubscriptionStatus = (subData?.status as SubscriptionStatus | null) || 'none';
    const billingPeriodEnd = subData?.current_period_end ? new Date(subData.current_period_end).getTime() : null;

    return NextResponse.json({
      plan,
      subscriptionStatus,
      requestCount: usageData?.ai_messages_count || 0,
      requestLimit: PLAN_LIMITS[plan].monthlyRequestLimit,
      totalTokens: 0,
      billingPeriodEnd,
      cancelAtPeriodEnd: false,
    });
  } catch (error) {
    return handleApiError('Usage API error', error);
  }
}
