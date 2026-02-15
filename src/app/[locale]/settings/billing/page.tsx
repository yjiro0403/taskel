'use client';

import { useEffect } from 'react';
import SettingsLayout from '@/components/SettingsLayout';
import { useStore } from '@/store/useStore';
import { PLAN_LIMITS } from '@/lib/billing/plans';
import type { PlanId } from '@/lib/billing/types';
import { Check, AlertTriangle, Loader2 } from 'lucide-react';
import clsx from 'clsx';

const PLAN_FEATURES: Record<PlanId, string[]> = {
  free: ['月20回のAI利用', '基本的なタスク管理', 'セクション管理'],
  pro: ['月200回のAI利用', '全タスク管理機能', 'ゴール管理', '優先サポート'],
  business: ['無制限のAI利用', '全機能アクセス', 'チームコラボレーション', '最優先サポート'],
};

export default function BillingSettingsPage() {
  const {
    billingPlan,
    subscriptionStatus,
    usageRequestCount,
    usageRequestLimit,
    billingPeriodEnd,
    cancelAtPeriodEnd,
    isBillingLoading,
    fetchBillingInfo,
    createCheckoutSession,
    createPortalSession,
  } = useStore();

  useEffect(() => {
    fetchBillingInfo();
  }, [fetchBillingInfo]);

  const handleUpgrade = async (priceId: string) => {
    const url = await createCheckoutSession(priceId);
    if (url) window.location.href = url;
  };

  const handleManage = async () => {
    const url = await createPortalSession();
    if (url) window.location.href = url;
  };

  const usagePercent = usageRequestLimit === Infinity
    ? 0
    : Math.min((usageRequestCount / usageRequestLimit) * 100, 100);

  const planCards: { id: PlanId; priceId?: string }[] = [
    { id: 'free' },
    { id: 'pro', priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID },
    { id: 'business', priceId: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID },
  ];

  return (
    <SettingsLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-xl font-bold text-gray-900">プラン・請求</h2>
          <p className="mt-1 text-sm text-gray-500">
            現在のプランと使用状況を確認できます。
          </p>
        </div>

        {isBillingLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-gray-400" size={32} />
          </div>
        ) : (
          <>
            {/* 解約予定警告 */}
            {cancelAtPeriodEnd && billingPeriodEnd && (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    プランは {new Date(billingPeriodEnd).toLocaleDateString('ja-JP')} に終了します
                  </p>
                  <p className="text-sm text-amber-700 mt-1">
                    期間終了後、Freeプランに切り替わります。
                  </p>
                </div>
              </div>
            )}

            {/* 現在のプラン + 使用量 */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">現在のプラン</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {PLAN_LIMITS[billingPlan].label}
                  </p>
                </div>
                <span
                  className={clsx(
                    'px-3 py-1 rounded-full text-xs font-medium',
                    subscriptionStatus === 'active' && 'bg-green-100 text-green-700',
                    subscriptionStatus === 'past_due' && 'bg-red-100 text-red-700',
                    subscriptionStatus === 'canceled' && 'bg-gray-100 text-gray-600',
                    subscriptionStatus === 'none' && 'bg-gray-100 text-gray-600'
                  )}
                >
                  {subscriptionStatus === 'active' ? '有効' :
                   subscriptionStatus === 'past_due' ? '支払い遅延' :
                   subscriptionStatus === 'canceled' ? '解約済み' : 'Free'}
                </span>
              </div>

              {/* 使用量プログレスバー */}
              {billingPlan !== 'business' && (
                <div className="mt-6">
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>AI利用回数</span>
                    <span>
                      {usageRequestCount} / {usageRequestLimit === Infinity ? '無制限' : usageRequestLimit}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className={clsx(
                        'h-2.5 rounded-full transition-all',
                        usagePercent >= 90 ? 'bg-red-500' :
                        usagePercent >= 70 ? 'bg-amber-500' : 'bg-indigo-500'
                      )}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                </div>
              )}

              {billingPlan !== 'free' && (
                <button
                  onClick={handleManage}
                  className="mt-4 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  プランを管理（Stripe Portal）
                </button>
              )}
            </div>

            {/* プラン比較 */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">プラン比較</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {planCards.map(({ id, priceId }) => {
                  const plan = PLAN_LIMITS[id];
                  const isCurrent = billingPlan === id;
                  const features = PLAN_FEATURES[id];

                  return (
                    <div
                      key={id}
                      className={clsx(
                        'border rounded-lg p-5 flex flex-col',
                        isCurrent
                          ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500'
                          : 'border-gray-200 bg-white'
                      )}
                    >
                      <h4 className="text-lg font-bold text-gray-900">{plan.label}</h4>
                      <p className="text-2xl font-bold text-gray-900 mt-2">
                        {plan.priceJPY === 0 ? '無料' : `¥${plan.priceJPY.toLocaleString()}`}
                        {plan.priceJPY > 0 && <span className="text-sm font-normal text-gray-500"> /月</span>}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        {plan.monthlyRequestLimit === Infinity
                          ? '無制限のAI利用'
                          : `月${plan.monthlyRequestLimit}回のAI利用`}
                      </p>

                      <ul className="mt-4 space-y-2 flex-1">
                        {features.map((feat) => (
                          <li key={feat} className="flex items-start gap-2 text-sm text-gray-700">
                            <Check size={16} className="text-green-500 shrink-0 mt-0.5" />
                            {feat}
                          </li>
                        ))}
                      </ul>

                      <div className="mt-4">
                        {isCurrent ? (
                          <span className="block w-full text-center py-2 text-sm font-medium text-indigo-600 bg-indigo-100 rounded-lg">
                            現在のプラン
                          </span>
                        ) : billingPlan !== 'free' ? (
                          <button
                            onClick={handleManage}
                            className="block w-full text-center py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                          >
                            プランを変更
                          </button>
                        ) : priceId ? (
                          <button
                            onClick={() => handleUpgrade(priceId)}
                            className="block w-full text-center py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                          >
                            アップグレード
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </SettingsLayout>
  );
}
