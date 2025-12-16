import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  if (!secretKey) {
    return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  }

  if (!priceId) {
    return res.status(500).json({ error: 'Missing STRIPE_SUBSCRIPTION_PRICE_ID' });
  }

  if (!baseUrl || !baseUrl.startsWith('http')) {
    return res.status(500).json({ error: 'Invalid NEXT_PUBLIC_BASE_URL' });
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: '2024-06-20',
  });

  try {
    const { userId } = req.body ?? {};

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        userId: userId ?? 'temp-user',
      },
      success_url: `${baseUrl}/subscribe?success=true`,
      cancel_url: `${baseUrl}/subscribe?canceled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: 'Stripe checkout failed' });
  }
}
