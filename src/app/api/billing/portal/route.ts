import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/billing/stripe';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const uid = user.id;

    const { data: subscription } = await (await createClient())
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', uid)
      .maybeSingle();
    const stripeCustomerId = subscription?.stripe_customer_id;

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
