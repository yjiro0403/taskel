import { StateCreator } from 'zustand';
import { StoreState } from '../types';
import type { PlanId } from '@/lib/billing/types';
import { auth } from '@/lib/firebase';

export interface BillingSlice {
  billingPlan: PlanId;
  subscriptionStatus: string;
  usageRequestCount: number;
  usageRequestLimit: number;
  usageTotalTokens: number;
  billingPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  isBillingLoading: boolean;
  fetchBillingInfo: () => Promise<void>;
  createCheckoutSession: (priceId: string) => Promise<string | null>;
  createPortalSession: () => Promise<string | null>;
}

async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export const createBillingSlice: StateCreator<StoreState, [], [], BillingSlice> = (set) => ({
  billingPlan: 'free',
  subscriptionStatus: 'none',
  usageRequestCount: 0,
  usageRequestLimit: 20,
  usageTotalTokens: 0,
  billingPeriodEnd: null,
  cancelAtPeriodEnd: false,
  isBillingLoading: false,

  fetchBillingInfo: async () => {
    const token = await getIdToken();
    if (!token) return;

    set({ isBillingLoading: true });
    try {
      const res = await fetch('/api/billing/usage', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch billing info');
      const data = await res.json();
      set({
        billingPlan: data.plan,
        subscriptionStatus: data.subscriptionStatus,
        usageRequestCount: data.requestCount,
        usageRequestLimit: data.requestLimit,
        usageTotalTokens: data.totalTokens,
        billingPeriodEnd: data.billingPeriodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      });
    } catch (err) {
      console.error('fetchBillingInfo error:', err);
    } finally {
      set({ isBillingLoading: false });
    }
  },

  createCheckoutSession: async (priceId: string) => {
    const token = await getIdToken();
    if (!token) return null;

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ priceId }),
      });
      if (!res.ok) throw new Error('Failed to create checkout session');
      const data = await res.json();
      return data.url || null;
    } catch (err) {
      console.error('createCheckoutSession error:', err);
      return null;
    }
  },

  createPortalSession: async () => {
    const token = await getIdToken();
    if (!token) return null;

    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Failed to create portal session');
      const data = await res.json();
      return data.url || null;
    } catch (err) {
      console.error('createPortalSession error:', err);
      return null;
    }
  },
});
