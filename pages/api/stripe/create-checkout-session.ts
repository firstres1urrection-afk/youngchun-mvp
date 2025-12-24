import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { sql } from '@vercel/postgres';
import { randomUUID } from 'crypto';

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

  const baseUrlRaw = process.env.NEXT_PUBLIC_BASE_URL || 'https://youngchun-mvp.vercel.app';
  const baseUrl = baseUrlRaw.trim().replace(/\/$/, '');
 // Determine language from request
  const lang = typeof (req.body as any)?.lang === 'string'
    ? (req.body as any).lang
    : typeof req.query?.lang === 'string'
      ? (req.query.lang as string)
      : 'en';
  const selectedPriceId = lang === 'ko'
    ? 'price_1Shjv3KVVTfSYsQLdGB42Sfr'
    : 'price_1ShjwIKVVTfSYsQLphryjUNj';

  if (!/^https?:\/\/.+/i.test(baseUrl)) {
    return res.status(500).json({
      error: 'Invalid NEXT_PUBLIC_BASE_URL',
      hint: 'Set NEXT_PUBLIC_BASE_URL to https://youngchun-mvp.vercel.app (no quotes, no trailing slash)',
    });
  }

  try {
    // generate a new anonymous user
const userId = randomUUID();

// placeholder email (NOT NULL 제약 회피)
const email = `anon+${userId}@youngchun.local`;

// insert into users table
await sql`
  INSERT INTO users (id, email, created_at)
  VALUES (${userId}, ${email}, NOW())
`;

    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: selectedPriceId,
          quantity: 1,
      
      ],
      allow_promotion_codes: true,
      metadata: {
        userId,
      },
      subscription_data: {
        metadata: { userId },
      },
      success_url: `${baseUrl}/select-contacts?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/error`,
    });

    if (!session.url) {
      return res.status(500).json({ error: 'Failed to create session' });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'something went wrong' });
  }
}
