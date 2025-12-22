import type { NextApiRequest, NextApiResponse } from 'next';
import { twiml } from 'twilio';
import { Pool } from '@neondatabase/serverless';

// Twilio uses urlencoded by default; disable bodyParser to get raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // parse raw urlencoded body
  let rawBody = '';
  try {
    for await (const chunk of req as any) {
      rawBody += chunk.toString();
    }
  } catch (e) {
    rawBody = '';
  }
  const params = new URLSearchParams(rawBody);
  const callSid = params.get('CallSid');
  const from = params.get('From');
  const to = params.get('To');
  const callStatus = params.get('CallStatus');

  // log call event; await to avoid serverless shutdown before DB commit
  async function logCallEvent(
    callSid: string | null,
    from: string | null,
    to: string | null,
    callStatus: string | null,
  ) {
    if (!callSid || !to) return;

    const { rows } = await pool.query(
      'SELECT user_id FROM call_forward_numbers WHERE twilio_number = $1 AND user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [to],
    );

    if (rows.length === 0) {
      console.warn('No user mapping found for number', to);
      return;
    }

    const userId = rows[0].user_id;

    try {
      await pool.query(
        'INSERT INTO call_events (call_sid, user_id, from_number, to_number, call_status) VALUES ($1, $2, $3, $4, $5)',
        [callSid, userId, from, to, callStatus],
      );
    } catch (err) {
      // ignore duplicate key errors or other DB issues
      console.warn('Error inserting call event', err);
    }
  }

  // ✅ 반드시 await로 로깅 보장
  try {
    await logCallEvent(callSid, from, to, callStatus);
  } catch (e) {
    console.error('call event logging failed', e);
  }

  const response = new twiml.VoiceResponse();
  const message =
    '지금 해외 체류 중이라 전화를 받을 수 없습니다. 잠시 후 다시 연락드리겠습니다.';
  response.say({ language: 'ko-KR' }, message);
  response.pause();
  response.say({ language: 'ko-KR' }, message);

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(response.toString());
}
