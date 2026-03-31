import { NextResponse } from 'next/server';
import { getStripe, getOrCreateStripeCustomer } from '@/lib/billing/stripe';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { billingCheckoutRequestSchema } from '@/lib/validations/ai';

export async function POST(request: Request) {
  try {
    const decoded = await requireAuth(request);
    const uid = decoded.uid;
    const email = decoded.email || '';
    const { priceId } = await parseJsonBody(request, billingCheckoutRequestSchema);

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
    return handleApiError('Checkout session error', error);
  }
}
