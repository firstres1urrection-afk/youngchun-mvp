import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import { sendPush } from '../../../lib/push/sendPush';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { call_sid, user_id } = req.query;
  const callSid = typeof call_sid === 'string' ? call_sid : undefined;
  const userId = typeof user_id === 'string' ? user_id : undefined;

  const debugParam = String(req.query.debug ?? '');
  const qToken = (req.query as any).token;
  const hToken = req.headers['x-internal-token'];
  let token: string | undefined;
  if (typeof qToken === 'string' && qToken) token = qToken;
  else if (typeof hToken === 'string' && hToken) token = hToken;

  const envToken = process.env.PUSH_INTERNAL_TOKEN;
  const allowed =
    debugParam === '1' &&
    typeof envToken === 'string' &&
    envToken &&
    token === envToken;

  const trace_id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const target = { call_sid: callSid ?? null, user_id: userId ?? null };

  console.log(
    `[push-api] start trace_id=${trace_id} target=${JSON.stringify(target)} debug=${debugParam}`,
  );

  if (!allowed) {
    console.log(
      `[push-api] kill_switch_blocked trace_id=${trace_id} debug=${debugParam} hasToken=${Boolean(
        token,
      )}`,
    );
    return res.status(200).json({
      ok: true,
      attempted: false,
      success: false,
      target,
      trace_id,
      reason: 'kill_switch_blocked',
    });
  }

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
    console.error(`[push-api] db error trace_id=${trace_id}`, err);
    return res.status(200).json({
      ok: true,
      attempted: false,
      success: false,
      target,
      trace_id,
      error: 'db_error',
    });
  }

  if (!callEvent) {
    console.log(`[push-api] no call events trace_id=${trace_id}`);
    return res.status(200).json({
      ok: true,
      attempted: false,
      success: false,
      target,
      trace_id,
      error: 'no call event',
    });
  }

  // ✅ inbound 체크 제거: callEvent 존재하면 무조건 push 시도
  console.log(
    `[push-api] attempt trace_id=${trace_id} call_sid=${callEvent.call_sid ?? 'null'} user_id=${callEvent.user_id ?? 'null'}`,
  );

  const pushResult = await sendPush({ trace_id });

  if ((pushResult as any).success) {
    console.log(`[push-api] success trace_id=${trace_id}`);
    return res.status(200).json({
      ok: true,
      attempted: true,
      success: true,
      target,
      trace_id,
    });
  }

  const errObj = {
    statusCode: (pushResult as any).statusCode ?? null,
    name: (pushResult as any).name ?? null,
    message: (pushResult as any).message ?? null,
  };

  console.error(`[push-api] failed trace_id=${trace_id}`, errObj);

  return res.status(200).json({
    ok: true,
    attempted: true,
    success: false,
    target,
    trace_id,
    error: errObj,
  });
}
