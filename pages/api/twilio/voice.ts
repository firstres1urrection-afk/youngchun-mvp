import type { NextApiRequest, NextApiResponse } from 'next';
import { twiml } from 'twilio';
import { Pool } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import { sendPush } from '../../../lib/push/sendPush';

export const config = {
  api: { bodyParser: false },
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function readRawBody(req: NextApiRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseFormUrlEncoded(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;

  const pairs = raw.split('&');
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (!p) continue;

    const eq = p.indexOf('=');
    const k = eq >= 0 ? p.slice(0, eq) : p;
    const v = eq >= 0 ? p.slice(eq + 1) : '';

    const key = decodeURIComponent(k.replace(/\+/g, ' '));
    const val = decodeURIComponent(v.replace(/\+/g, ' '));
    out[key] = val;
  }
  return out;
}

// Map a Twilio phone number to a user_id from call_forward_numbers
async function getUserIdForNumber(to: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT user_id FROM call_forward_numbers
       WHERE twilio_number = $1
         AND is_released = false
         AND expire_at > NOW()
         AND user_id IS NOT NULL
       LIMIT 1`,
      [to],
    );
    if (rows.length > 0) {
      return rows[0].user_id;
    }
    return null;
  } catch (error) {
    console.error('[voice] Failed to fetch user_id', { error, to });
    return null;
  }
}

async function logCallEvent(callSid: string, from: string, to: string, callStatus: string, userId: string | null) {
  // If no user_id is provided, skip inserting into call_events to avoid NOT NULL constraint
  if (!userId) {
    console.warn('[voice] user_mapping_not_found', { callSid, to });
    return;
  }
  try {
    await pool.query(
      `
      INSERT INTO call_events (call_sid, from_number, to_number, call_status, user_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (call_sid) DO NOTHING
      `,
      [callSid, from, to, callStatus, userId],
    );
  } catch (error) {
    console.error('[voice] Failed to log call event', { error, callSid });
  }
}

async function trySendPushOnce(callSid: string, traceId: string) {
  try {
    const { rows } = await pool.query(
      'SELECT push_sent_at FROM call_events WHERE call_sid = $1 LIMIT 1',
      [callSid],
    );

    const shouldSendPush = rows.length > 0 && rows[0].push_sent_at === null;
    if (!shouldSendPush) {
      return { attempted: false, success: false, reason: 'already_sent_or_missing_row' };
    }

    try {
      const result = await sendPush({ trace_id: traceId } as any);
      const ok = !!(result && (result as any).success);

      if (ok) {
        await pool.query('UPDATE call_events SET push_sent_at = NOW() WHERE call_sid = $1', [callSid]);
        return { attempted: true, success: true, reason: 'sent_and_marked' };
      }

      return { attempted: true, success: false, reason: 'sendPush_not_success' };
    } catch (err) {
      console.error('[voice] sendPush threw', { err, callSid, traceId });
      return { attempted: true, success: false, reason: 'sendPush_threw' };
    }
  } catch (err) {
    console.error('[voice] DB check failed (push_sent_at)', { err, callSid, traceId });
    return { attempted: false, success: false, reason: 'db_check_failed' };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Always prepare TwiML first so Twilio never gets a non-TwiML/5xx response.
  const vr = new twiml.VoiceResponse();
  const message = '지금 해외 체류 중이라 전화를 받을 수 없습니다. 잠시 후 다시 연락드리겠습니다.';
  vr.say({ language: 'ko-KR' }, message);
  vr.pause({ length: 1 });
  vr.say({ language: 'ko-KR' }, message);

  try {
    if (req.method !== 'POST') {
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send(vr.toString());
    }

    const traceId = randomUUID();

    let parsed: Record<string, string> = {};
    try {
      const raw = await readRawBody(req);
      parsed = parseFormUrlEncoded(raw);
    } catch (err) {
      console.error('[voice] Failed to read/parse raw body', { err, traceId });
      // continue; still return TwiML
    }

    const callSid = parsed.CallSid || '';
    const from = parsed.From || '';
    const to = parsed.To || '';
    const callStatus = parsed.CallStatus || '';

    // determine user_id mapping
    let userId: string | null = null;
    if (to) {
      userId = await getUserIdForNumber(to);
    }

    if (callSid) {
      await logCallEvent(callSid, from, to, callStatus, userId);
    } else {
      console.warn('[voice] Missing CallSid', { traceId });
    }

    let push_attempted = false;
    let push_success = false;
    let push_reason = 'skipped';

    // Only attempt push if callSid and userId mapping succeeded
    if (callSid && userId) {
      const r = await trySendPushOnce(callSid, traceId);
      push_attempted = !!r.attempted;
      push_success = !!r.success;
      push_reason = r.reason;
    } else {
      if (!userId) {
        push_reason = 'user_mapping_not_found';
      }
    }

    console.log(
      JSON.stringify({
        tag: 'twilio_voice',
        trace_id: traceId,
        call_sid: callSid,
        from,
        to,
        call_status: callStatus,
        push_attempted,
        push_success,
        push_reason,
      }),
    );
  } catch (err) {
    console.error('[voice] Unhandled error (still returning TwiML)', err);
  }

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(vr.toString());
}
