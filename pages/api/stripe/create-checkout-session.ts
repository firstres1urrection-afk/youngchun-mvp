import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { sql } from '@vercel/postgres';
import { randomUUID } from 'crypto';

const PRICE_KRW_8900 = 'price_1Shjv3KVVTfSYsQLdGB42Sfr';
const PRICE_USD_699 = 'price_1ShjwIKVVTfSYsQLphryjUNj';

type Data =
  | { url: string }
  | { error: string; hint?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  }

  const baseUrlRaw =
    process.env.NEXT_PUBLIC_BASE_URL || 'https://youngchun-mvp.vercel.app';
  const baseUrl = baseUrlRaw.trim().replace(/\/$/, '');

  if (!/^https?:\/\/.+/i.test(baseUrl)) {
    return res.status(500).json({
      error: 'Invalid NEXT_PUBLIC_BASE_URL',
      hint: 'Set NEXT_PUBLIC_BASE_URL to a valid URL (no quotes, no trailing slash)',
    });
  }

  // Determine language from request: body.lang -> query.lang -> 'en'
  const lang =
    typeof (req.body as any)?.lang === 'string'
      ? ((req.body as any).lang as string)
      : typeof req.query?.lang === 'string'
      ? (req.query.lang as string)
      : 'en';

  const selectedPriceId = lang === 'ko' ? PRICE_KRW_8900 : PRICE_USD_699;

  try {
    // Create an anonymous user row (existing logic preserved)
    const userId = randomUUID();
    const email = `anon+${userId}@youngchun.local`;

    await sql`
      INSERT INTO users (id, email, created_at)
      VALUES (${userId}, ${email}, NOW())
    `;

    const stripe = new Stripe(secretKey, {
      apiVersion: '2025-02-24.acacia' as any, // keep compatible if your project pins an apiVersion; remove if not needed
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: selectedPriceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,

      // metadata on session + subscription (preserve existing pattern)
      metadata: {
        userId,
        lang,
      },
      subscription_data: {
        metadata: { userId, lang },
      },

      // Keep your existing redirect paths (change if those routes don't exist)
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
