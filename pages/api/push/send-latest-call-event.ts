import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import sendPush from '../../../lib/push/sendPush';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { call_sid, user_id } = req.query;
  const callSid = typeof call_sid === 'string' ? call_sid : undefined;
  const userId = typeof user_id === 'string' ? user_id : undefined;

  // Only allow manual push in non-production environments
  const isProd = process.env.NODE_ENV === 'production';
  const debugParam = String(req.query.debug ?? '0');
  const qToken = (req.query as any).token;
  const hToken = req.headers['x-internal-token'];
  let token: string | undefined;
  if (typeof qToken === 'string' && qToken) token = qToken;
  else if (typeof hToken === 'string' && hToken) token = hToken;

  const envToken = process.env.PUSH_INTERNAL_TOKEN;
  const allowed = !isProd && debugParam === '1' && typeof envToken === 'string' && envToken && token === envToken;

  if (!allowed) {
    return res.status(200).json({ attempted: false, reason: isProd ? 'disabled_in_production' : 'kill_switch_blocked' });
  }

  try {
    let row: any;
    if (callSid) {
      const { rows } = await pool.query('SELECT * FROM call_events WHERE call_sid = $1 ORDER BY created_at DESC LIMIT 1', [callSid]);
      row = rows[0];
    } else if (userId) {
      const { rows } = await pool.query('SELECT * FROM call_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
      row = rows[0];
    } else {
      const { rows } = await pool.query('SELECT * FROM call_events ORDER BY created_at DESC LIMIT 1');
      row = rows[0];
    }

    const traceId = row?.call_sid ?? Date.now().toString();
    const result = await sendPush({ trace_id: traceId });
    return res.status(200).json({ attempted: true, success: (result as any).success });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
