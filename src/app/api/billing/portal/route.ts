import { NextResponse } from 'next/server';
import { getAuth, getDb } from '@/lib/firebaseAdmin';
import { getStripe } from '@/lib/billing/stripe';

export async function POST(request: Request) {
  try {
    // Bearer トークン認証
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    let uid: string;

    try {
      const decoded = await getAuth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

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
    console.error('Portal session error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
