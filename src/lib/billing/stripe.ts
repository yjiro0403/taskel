import Stripe from 'stripe';
import { getDb } from '@/lib/firebaseAdmin';

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

/**
 * ユーザーのStripe Customerを取得、なければ作成してFirestoreに保存
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string
): Promise<string> {
  const db = getDb();
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  const userData = userSnap.data();

  if (userData?.stripeCustomerId) {
    return userData.stripeCustomerId;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    metadata: { firebaseUserId: userId },
  });

  await userRef.set(
    { stripeCustomerId: customer.id },
    { merge: true }
  );

  return customer.id;
}
