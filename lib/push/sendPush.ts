import { sql } from '@vercel/postgres';
const webpush = require('web-push');

export async function sendPush() {
  try {
    // ensure table exists
    await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint TEXT UNIQUE,
      p256dh TEXT,
      auth TEXT,
      user_agent TEXT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );`;
    const { rows } = await sql`SELECT * FROM push_subscriptions ORDER BY created_at DESC LIMIT 1;`;
    if (!rows || rows.length === 0) {
      console.log('No push subscriptions found');
      return;
    }
    const sub = rows[0];
    const subscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    };
    const payload = JSON.stringify({
      title: 'Youngchun',
      body: '📞 새로운 전화 시도가 있었습니다.',
    });
    await webpush.sendNotification(subscription, payload);
    console.log('Push notification sent');
  } catch (err) {
    console.error('Failed to send push', err);
  }
}
