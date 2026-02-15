import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin';
import { getStripe } from '@/lib/billing/stripe';
import { getPlanFromPriceId } from '@/lib/billing/plans';
import type { SubscriptionDoc, SubscriptionStatus } from '@/lib/billing/types';
import Stripe from 'stripe';

/** Stripe v20+: period fields are on items, not subscription root */
function getSubscriptionPeriod(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  return {
    currentPeriodStart: (item?.current_period_start ?? 0) * 1000,
    currentPeriodEnd: (item?.current_period_end ?? 0) * 1000,
  };
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
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const db = getDb();

  // 冪等性チェック
  const eventRef = db.collection('stripeEvents').doc(event.id);
  const eventSnap = await eventRef.get();
  if (eventSnap.exists) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription' || !session.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        );
        const userId = subscription.metadata.userId || session.metadata?.userId;
        if (!userId) {
          console.error('No userId in subscription metadata');
          break;
        }

        const priceId = subscription.items.data[0]?.price?.id || '';
        const plan = getPlanFromPriceId(priceId);
        const period = getSubscriptionPeriod(subscription);

        const subDoc: SubscriptionDoc = {
          userId,
          stripeCustomerId: subscription.customer as string,
          stripePriceId: priceId,
          plan,
          status: subscription.status as SubscriptionStatus,
          currentPeriodStart: period.currentPeriodStart,
          currentPeriodEnd: period.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        await db.collection('subscriptions').doc(subscription.id).set(subDoc);
        await db.collection('users').doc(userId).set(
          {
            plan,
            stripeCustomerId: subscription.customer as string,
            subscriptionStatus: subscription.status,
          },
          { merge: true }
        );
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata.userId;
        if (!userId) break;

        const priceId = subscription.items.data[0]?.price?.id || '';
        const plan = getPlanFromPriceId(priceId);
        const period = getSubscriptionPeriod(subscription);

        await db.collection('subscriptions').doc(subscription.id).set(
          {
            stripePriceId: priceId,
            plan,
            status: subscription.status,
            currentPeriodStart: period.currentPeriodStart,
            currentPeriodEnd: period.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            updatedAt: Date.now(),
          },
          { merge: true }
        );

        await db.collection('users').doc(userId).set(
          {
            plan,
            subscriptionStatus: subscription.status,
          },
          { merge: true }
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata.userId;
        if (!userId) break;

        await db.collection('subscriptions').doc(subscription.id).set(
          {
            status: 'canceled',
            cancelAtPeriodEnd: false,
            updatedAt: Date.now(),
          },
          { merge: true }
        );

        await db.collection('users').doc(userId).set(
          {
            plan: 'free',
            subscriptionStatus: 'canceled',
          },
          { merge: true }
        );
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subRef = invoice.parent?.subscription_details?.subscription;
        const subId = typeof subRef === 'string' ? subRef : subRef?.id;
        if (!subId) break;

        const subSnap = await db.collection('subscriptions').doc(subId).get();
        const subData = subSnap.data();
        if (!subData?.userId) break;

        await db.collection('users').doc(subData.userId).set(
          { subscriptionStatus: 'past_due' },
          { merge: true }
        );
        await db.collection('subscriptions').doc(subId).set(
          { status: 'past_due', updatedAt: Date.now() },
          { merge: true }
        );
        break;
      }
    }

    // 冪等性ガード：処理済みイベントを記録
    await eventRef.set({
      eventId: event.id,
      type: event.type,
      processedAt: Date.now(),
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
