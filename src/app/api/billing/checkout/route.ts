import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/firebaseAdmin';
import { getStripe, getOrCreateStripeCustomer } from '@/lib/billing/stripe';

export async function POST(request: Request) {
  try {
    // Bearer トークン認証
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    let uid: string;
    let email: string;

    try {
      const decoded = await getAuth().verifyIdToken(token);
      uid = decoded.uid;
      email = decoded.email || '';
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { priceId } = await request.json();
    if (!priceId) {
      return NextResponse.json({ error: 'priceId is required' }, { status: 400 });
    }

    const customerId = await getOrCreateStripeCustomer(uid, email);
    const stripe = getStripe();

    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://taskel.vercel.app';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      currency: 'jpy',
      locale: 'ja',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { userId: uid },
      },
      success_url: `${origin}/settings/billing?success=true`,
      cancel_url: `${origin}/settings/billing?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Checkout session error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
