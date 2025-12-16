import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@vercel/postgres';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { endpoint, keys } = req.body;
    const p256dh = keys?.p256dh;
    const auth = keys?.auth;
    const userAgent = req.headers['user-agent'] || null;

    await sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        endpoint TEXT UNIQUE,
        p256dh TEXT,
        auth TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }

    await sql`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent)
      VALUES (${endpoint}, ${p256dh}, ${auth}, ${userAgent})
      ON CONFLICT (endpoint) DO NOTHING
    `;

    return res.status(200).json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
