import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import { getStripe } from '@/lib/billing/stripe';
import { getPlanFromPriceId } from '@/lib/billing/plans';
import { createClient } from '@/lib/supabase/server';

function getSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  return item?.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = await createClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription' || !session.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const userId = subscription.metadata.userId || session.metadata?.userId;
        if (!userId) break;

        const priceId = subscription.items.data[0]?.price?.id || '';
        const plan = getPlanFromPriceId(priceId);

        await supabase.from('subscriptions').upsert({
          user_id: userId,
          stripe_customer_id: subscription.customer as string,
          stripe_subscription_id: subscription.id,
          plan,
          status: subscription.status as any,
          current_period_end: getSubscriptionPeriodEnd(subscription),
        });
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata.userId;
        if (!userId) break;

        const priceId = subscription.items.data[0]?.price?.id || '';
        const plan = event.type === 'customer.subscription.deleted' ? 'free' : getPlanFromPriceId(priceId);
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : subscription.status;

        await supabase.from('subscriptions').upsert({
          user_id: userId,
          stripe_customer_id: subscription.customer as string,
          stripe_subscription_id: subscription.id,
          plan,
          status: status as any,
          current_period_end: getSubscriptionPeriodEnd(subscription),
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subRef = invoice.parent?.subscription_details?.subscription;
        const subId = typeof subRef === 'string' ? subRef : subRef?.id;
        if (!subId) break;

        await supabase.from('subscriptions').update({
          status: 'past_due',
        }).eq('stripe_subscription_id', subId);
        break;
      }
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
