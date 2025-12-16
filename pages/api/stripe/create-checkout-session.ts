import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;

  if (!secretKey) {
    return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  }

  if (!priceId) {
    return res.status(500).json({ error: 'Missing STRIPE_SUBSCRIPTION_PRICE_ID' });
  }

  const stripe = new Stripe(secretKey as string);

  try {
    const { userId } = req.body || {};

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
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://youngchun-mvp.vercel.app';
...
success_url: `${baseUrl}/subscribe?success=true`,
cancel_url: `${baseUrl}/subscribe?canceled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
