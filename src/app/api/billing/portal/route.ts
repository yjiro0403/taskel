import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin';
import { getStripe } from '@/lib/billing/stripe';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';

export async function POST(request: Request) {
  try {
    const { uid } = await requireAuth(request);

    const db = getDb();
    const userSnap = await db.collection('users').doc(uid).get();
    const stripeCustomerId = userSnap.data()?.stripeCustomerId;

    if (!stripeCustomerId) {
      return NextResponse.json({ error: 'No billing account found' }, { status: 404 });
    }

    const stripe = getStripe();
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://taskel.vercel.app';

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${origin}/settings/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return handleApiError('Portal session error', error);
  }
}
