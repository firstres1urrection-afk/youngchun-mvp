import type { NextApiRequest, NextApiResponse } from 'next';
import { twiml } from 'twilio';
import { Pool } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import { sendPush } from '../../../lib/push/sendPush';

export const config = {
  api: {
    bodyParser: false, // Twilio sends x-www-form-urlencoded; we will parse raw body ourselves
  },
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function parseTwilioBody(req: NextApiRequest): Promise<Record<string, string>> {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      const params = new URLSearchParams(data);
      const result: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        result[key] = value;
      }
      resolve(result);
    });
    req.on('error', reject);
  });
}

async function logCallEvent(callSid: string, from: string, to: string, callStatus: string) {
  try {
    await pool.query(
      `
      INSERT INTO call_events (call_sid, from_number, to_number, call_status)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (call_sid) DO NOTHING
      `,
      [callSid, from, to, callStatus],
    );
  } catch (error) {
    console.error('[voice] Failed to log call event', { error, callSid });
  }
}

async function trySendPushOnce(callSid: string, traceId: string) {
  // Returns { attempted, success }
  let attempted = false;
  let success = false;

  try {
    const { rows } = await pool.query(
      'SELECT push_sent_at FROM call_events WHERE call_sid = $1 LIMIT 1',
      [callSid],
    );

    const shouldSendPush = rows.length > 0 && rows[0].push_sent_at === null;

    if (!shouldSendPush) {
      return { attempted: false, success: false, reason: 'already_sent_or_missing_row' };
    }

    attempted = true;

    try {
      const result = await sendPush({ trace_id: traceId } as any);
      const ok = !!(result && (result as any).success);

      if (ok) {
        success = true;
        await pool.query(
          'UPDATE call_events SET push_sent_at = NOW() WHERE call_sid = $1',
          [callSid],
        );
        return { attempted, success, reason: 'sent_and_marked' };
      }

      return { attempted, success: false, reason: 'sendPush_returned_not_success' };
    } catch (err) {
      console.error('[voice] sendPush threw', { err, callSid, traceId });
      return { attempted, success: false, reason: 'sendPush_threw' };
    }
  } catch (err) {
    console.error('[voice] error checking push_sent_at', { err, callSid, traceId });
    return { attempted, success: false, reason: 'db_check_failed' };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1) Always prepare TwiML first so we can always respond even if DB/push fails
  const response = new twiml.VoiceResponse();
  const message = '지금 해외 체류 중이라 전화를 받을 수 없습니다. 잠시 후 다시 연락드리겠습니다.';
  response.say({ language: 'ko-KR' }, message);
  response.pause({ length: 1 });
  response.say({ language: 'ko-KR' }, message);

  // 2) Always return TwiML at the end, no matter what happens
  try {
    if (req.method !== 'POST') {
      // Twilio should POST, but respond with TwiML anyway to avoid Twilio error prompt
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send(response.toString());
    }

    const traceId = randomUUID();

    let parsedBody: Record<string, string> = {};
    try {
      parsedBody = await parseTwilioBody(req);
    } catch (err) {
      console.error('[voice] Failed to parse Twilio webhook body', { err, traceId });
      // continue; still return TwiML
    }

    const callSid = parsedBody.CallSid || '';
    const from = parsedBody.From || '';
    const to = parsedBody.To || '';
    const callStatus = parsedBody.CallStatus || '';

    // Log call event (best-effort)
    if (callSid) {
      await logCallEvent(callSid, from, to, callStatus);
    } else {
      console.warn('[voice] Missing CallSid', { traceId, parsedKeys: Object.keys(parsedBody || {}) });
    }

    // Push logic (best-effort, must not block TwiML)
    let push_attempted = false;
    let push_success = false;
    let push_reason = 'skipped';

    if (callSid) {
      const pushResult = await trySendPushOnce(callSid, traceId);
      push_attempted = !!pushResult.attempted;
      push_success = !!pushResult.success;
      push_reason = (pushResult as any).reason || push_reason;
    }

    console.log(
      JSON.stringify({
        tag: 'twilio_voice',
        call_sid: callSid,
        from,
        to,
        call_status: callStatus,
        trace_id: traceId,
        push_attempted,
        push_success,
        push_reason,
      }),
    );
  } catch (err) {
    // Never throw; Twilio must receive TwiML
    console.error('[voice] Unhandled error (will still return TwiML)', err);
  }

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(response.toString());
}
