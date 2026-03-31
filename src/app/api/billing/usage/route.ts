import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin';
import { PLAN_LIMITS } from '@/lib/billing/plans';
import type { PlanId, MonthlyUsageDoc, SubscriptionStatus } from '@/lib/billing/types';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: Request) {
  try {
    const { uid } = await requireAuth(request);

    const db = getDb();
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [userSnap, usageSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('usage').doc(uid).collection('monthly').doc(monthKey).get(),
    ]);

    const userData = userSnap.data();
    const plan: PlanId = userData?.plan || 'free';
    const subscriptionStatus: SubscriptionStatus = userData?.subscriptionStatus || 'none';
    const usageData = usageSnap.data() as MonthlyUsageDoc | undefined;

    // subscription情報を取得（cancelAtPeriodEnd, currentPeriodEnd用）
    let billingPeriodEnd: number | null = null;
    let cancelAtPeriodEnd = false;

    if (subscriptionStatus !== 'none') {
      const subsQuery = await db
        .collection('subscriptions')
        .where('userId', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (!subsQuery.empty) {
        const subData = subsQuery.docs[0].data();
        billingPeriodEnd = subData.currentPeriodEnd || null;
        cancelAtPeriodEnd = subData.cancelAtPeriodEnd || false;
      }
    }

    return NextResponse.json({
      plan,
      subscriptionStatus,
      requestCount: usageData?.requestCount || 0,
      requestLimit: PLAN_LIMITS[plan].monthlyRequestLimit,
      totalTokens: usageData?.totalTokens || 0,
      billingPeriodEnd,
      cancelAtPeriodEnd,
    });
  } catch (error) {
    return handleApiError('Usage API error', error);
  }
}
