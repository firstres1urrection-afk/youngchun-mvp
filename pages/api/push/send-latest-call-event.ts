import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import { sendPush } from '../../../lib/push/sendPush';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { call_sid, user_id } = req.query;

  const callSid = typeof call_sid === 'string' ? call_sid : undefined;
  const userId = typeof user_id === 'string' ? user_id : undefined;

  let callEvent: any = null;
  try {
    if (callSid) {
      const { rows } = await pool.query(
        'SELECT * FROM call_events WHERE call_sid = $1 ORDER BY created_at DESC LIMIT 1',
        [callSid],
      );
      if (rows.length > 0) callEvent = rows[0];
    } else if (userId) {
      const { rows } = await pool.query(
        'SELECT * FROM call_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId],
      );
      if (rows.length > 0) callEvent = rows[0];
    }
  } catch (err) {
    console.error('error querying call_events', err);
  }

  let attempted = false;
  let reason: string | undefined;
  if (callEvent) {
    try {
      await sendPush();
      attempted = true;
    } catch (err: any) {
      console.error('push failed', err);
      attempted = true;
      reason = err?.message ?? 'push failed';
    }
  }

  res.status(200).json({ ok: true, attempted, ...(reason ? { reason } : {}) });
}
