import { sql } from '@vercel/postgres';
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'mailto:firstres1urrection@gmail.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export type SendPushResult = {
  success: boolean;
  statusCode?: number | null;
  message?: string;
  name?: string | null;
};

export async function sendPush(): Promise<SendPushResult> {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return { success: false, message: 'missing VAPID keys' };
    }
    // ensure table exists
    await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint TEXT UNIQUE,
      p256dh TEXT,
      auth TEXT,
      user_agent TEXT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );`;
    const { rows } = await sql`SELECT * FROM push_subscriptions ORDER BY created_at DESC LIMIT 1`;
    if (!rows || rows.length === 0) {
      return { success: false, message: 'No push subscriptions found' };
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
      body: '새로운 전화 시도가 있었습니다.',
    });
    await webpush.sendNotification(subscription, payload);
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      statusCode: err?.statusCode ?? null,
      name: err?.name ?? null,
      message: err?.message ?? String(err),
    };
  }
}
