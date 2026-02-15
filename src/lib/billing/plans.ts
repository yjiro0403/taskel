import type { PlanId } from './types';

export const PLAN_LIMITS = {
  free:     { monthlyRequestLimit: 20,       label: 'Free',     priceJPY: 0 },
  pro:      { monthlyRequestLimit: 200,      label: 'Pro',      priceJPY: 980 },
  business: { monthlyRequestLimit: 1000,     label: 'Business', priceJPY: 2980 },
} as const;

const priceIdToPlan: Record<string, PlanId> = {};

// 環境変数からpriceId→planマッピングを構築
function buildPriceIdMap() {
  if (Object.keys(priceIdToPlan).length > 0) return;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  const businessPriceId = process.env.STRIPE_BUSINESS_PRICE_ID;
  if (proPriceId) priceIdToPlan[proPriceId] = 'pro';
  if (businessPriceId) priceIdToPlan[businessPriceId] = 'business';
}

export function getPlanFromPriceId(priceId: string): PlanId {
  buildPriceIdMap();
  return priceIdToPlan[priceId] || 'free';
}
