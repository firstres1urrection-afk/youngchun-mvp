import { sql } from '@vercel/postgres';
import type { NextApiRequest, NextApiResponse } from 'next';
const webpush = require('web-push');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Ensure table exists
  await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint TEXT UNIQUE,
    p256dh TEXT,
    auth TEXT,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );`;

  // Fetch latest subscription
  const { rows } = await sql`SELECT * FROM push_subscriptions ORDER BY created_at DESC LIMIT 1;`;
  if (rows.length === 0) {
    return res.status(404).json({ error: 'No subscriptions' });
  }

  const sub = rows[0];
  const subscription = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };

  const vapidSubject = process.env.VAPID_SUBJECT;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    return res.status(500).json({ error: 'VAPID keys not set' });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({
    title: 'Youngchun',
    body: '테스트 푸시입니다.',
  });

  try {
    await webpush.sendNotification(subscription as any, payload);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to send push' });
  }
}
