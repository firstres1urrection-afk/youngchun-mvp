import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import { sendPush } from '../../../lib/push/sendPush';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { call_sid, user_id } = req.query;

  const callSid = typeof call_sid === 'string' ? call_sid : undefined;
  const userId = typeof user_id === 'string' ? user_id : undefined;

  // determine target object
  const target = {
    call_sid: callSid ?? null,
    user_id: userId ?? null,
  };

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
  let success = false;
  let error: any = null;

  // generate trace_id using current timestamp and random string
  const trace_id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  if (callEvent) {
    attempted = true;
    try {
      
       await sendPush();
      success = true;}
    } catch (err: any) {
      success = false;
      error = {
      statusCode: typeof err?.statusCode === 'number' ? err.statusCode : null,
       name: typeof err?.name === 'string' ? err.name : null,
       message: typeof err?.message === 'string' ? err.message : String(err),
      };
      console.error(`[push] failed trace_id=${trace_id}`, err);
    }
  }

  const response: any = {
    ok: true,
    attempted,
    success,
    target,
    trace_id,
  };

  if (!success && error) {
    response.error = error;
  }

  res.status(200).json(response);
}
