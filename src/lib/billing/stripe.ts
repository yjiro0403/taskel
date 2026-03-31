import Stripe from 'stripe';

import { createClient } from '@/lib/supabase/server';

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

export async function getOrCreateStripeCustomer(
  userId: string,
  email: string
): Promise<string> {
  const supabase = await createClient();
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (subscription?.stripe_customer_id) {
    return subscription.stripe_customer_id;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });

  await supabase.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: customer.id,
  });

  return customer.id;
}
