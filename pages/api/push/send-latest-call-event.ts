import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import { sendPush } from '../../../lib/push/sendPush';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { call_sid, user_id } = req.query;
  const callSid = typeof call_sid === 'string' ? call_sid : undefined;
  const userId = typeof user_id === 'string' ? user_id : undefined;

  // 🔒 Guard: only allow sending push when debug=1
  const debug = req.query.debug === '1';

  const trace_id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const target = {
    call_sid: callSid ?? null,
    user_id: userId ?? null,
  };

  // Always log start (for correlation)
  console.log(
    `[push-api] start trace_id=${trace_id} target=${JSON.stringify(target)} debug=${debug}`,
  );

  // ✅ 폭주 차단: debug=1 없으면 푸시 절대 발송하지 않음
  if (!debug) {
    console.log(`[push-api] guard_blocked trace_id=${trace_id}`);
    return res.status(200).json({
      ok: true,
      attempted: false,
      success: false,
      target,
      trace_id,
      reason: 'guard_blocked',
    });
  }

  // ---- below: normal behavior (only when debug=1) ----

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
    console.error(`[push-api] error querying call_events trace_id=${trace_id}`, err);
  }

  if (!callEvent) {
    console.log(
      `[push-api] skip trace_id=${trace_id} reason=no_call_event target=${JSON.stringify(target)}`,
    );
    return res.status(200).json({
      ok: true,
      attempted: false,
      success: false,
      target,
      trace_id,
      reason: 'no_call_event',
    });
  }

  console.log(
    `[push-api] attempt trace_id=${trace_id} call_sid=${callEvent.call_sid ?? 'null'} user_id=${callEvent.user_id ?? 'null'}`,
  );

  // sendPush returns success/failure result (SSOT)
  const pushResult = await sendPush({ trace_id });

  if (pushResult.success) {
    console.log(`[push-api] success trace_id=${trace_id}`);
    return res.status(200).json({
      ok: true,
      attempted: true,
      success: true,
      target,
      trace_id,
    });
  }

  const error = {
    statusCode: pushResult.statusCode ?? null,
    name: pushResult.name ?? null,
    message: pushResult.message ?? 'push failed',
  };

  console.error(`[push-api] failed trace_id=${trace_id}`, error);

  return res.status(200).json({
    ok: true,
    attempted: true,
    success: false,
    target,
    trace_id,
    error,
  });
}
