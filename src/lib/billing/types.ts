// Firestore ドキュメントの型定義（billing関連）

export interface UserBillingFields {
  stripeCustomerId?: string;
  plan: PlanId;
  subscriptionStatus: SubscriptionStatus;
}

export type PlanId = 'free' | 'pro' | 'business';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'none';

export interface SubscriptionDoc {
  userId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MonthlyUsageDoc {
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  lastRequestAt: number;
  updatedAt: number;
}

export interface StripeEventDoc {
  eventId: string;
  type: string;
  processedAt: number;
}
