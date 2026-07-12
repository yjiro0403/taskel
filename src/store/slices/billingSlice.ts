import { StateCreator } from 'zustand';

import type { PlanId } from '@/lib/billing/types';
import { StoreState } from '../types';

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
  resetBillingSlice: () => void;
}

export const createBillingSlice: StateCreator<StoreState, [], [], BillingSlice> = (set, get) => ({
  billingPlan: 'free',
  subscriptionStatus: 'none',
  usageRequestCount: 0,
  usageRequestLimit: 20,
  usageTotalTokens: 0,
  billingPeriodEnd: null,
  cancelAtPeriodEnd: false,
  isBillingLoading: false,

  fetchBillingInfo: async () => {
    if (!get().user) return;

    set({ isBillingLoading: true });
    try {
      const res = await fetch('/api/billing/usage');
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
    if (!get().user) return null;

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
    if (!get().user) return null;

    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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

  resetBillingSlice: () => set({
    billingPlan: 'free',
    subscriptionStatus: 'none',
    usageRequestCount: 0,
    usageRequestLimit: 20,
    usageTotalTokens: 0,
    billingPeriodEnd: null,
    cancelAtPeriodEnd: false,
    isBillingLoading: false,
  }),
});
