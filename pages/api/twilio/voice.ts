import { NextApiRequest, NextApiResponse } from 'next';
import { twiml } from 'twilio';
import { Pool } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import { sendPush } from '../../../lib/push/sendPush';

export const config = { api: { bodyParser: false } };

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function logCallEvent(callSid: string, from: string, to: string, callStatus: string) {
  try {
    await pool.query(
      'INSERT INTO call_events (call_sid, from_number, to_number, call_status) VALUES ($1, $2, $3, $4) ON CONFLICT (call_sid) DO NOTHING',
      [callSid, from, to, callStatus],
    );
  } catch (error) {
    console.error('Failed to log call event', error);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Twilio sends x-www-form-urlencoded
  const rawBody = req.body as any;
  const callSid = rawBody.CallSid as string;
  const from = rawBody.From as string;
  const to = rawBody.To as string;
  const callStatus = rawBody.CallStatus as string;

  await logCallEvent(callSid, from, to, callStatus);

  // push notification logic
  let pushAttempted = false;
  let pushSuccess = false;
  const traceId = randomUUID();

  if (callSid) {
    try {
      const { rows } = await pool.query('SELECT push_sent_at FROM call_events WHERE call_sid = $1', [callSid]);
      const shouldSendPush = rows.length > 0 && rows[0].push_sent_at === null;
      if (shouldSendPush) {
        pushAttempted = true;
        try {
          const pushResult = await sendPush({ trace_id: traceId });
          if (pushResult && (pushResult as any).success) {
            pushSuccess = true;
            await pool.query('UPDATE call_events SET push_sent_at = NOW() WHERE call_sid = $1', [callSid]);
          }
        } catch (err) {
          console.error('push notification failed', err);
        }
      }
    } catch (err) {
      console.error('error checking push_sent_at', err);
    }
  }
  // log push details
  console.log(
    JSON.stringify({ call_sid: callSid, push_attempted: pushAttempted, push_success: pushSuccess, trace_id: traceId }),
  );

  const response = new twiml.VoiceResponse();
  const message = '지금 해외 체류 중이라 전화를 받을 수 없습니다. 잠시 후 다시 연락드리겠습니다.';
  response.say({ language: 'ko-KR' }, message);
  response.pause();
  response.say({ language: 'ko-KR' }, message);

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(response.toString());
}
