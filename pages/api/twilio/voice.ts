import type { NextApiRequest, NextApiResponse } from 'next';
import { twiml } from 'twilio';
import { Pool } from '@neondatabase/serverless';
import { sendPush } from '../../../lib/push/sendPush';

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

  // asynchronously log call event; errors are swallowed
  (async () => {
    try {
      if (!callSid || !to) {
        return;
      }
      // query user id from call_forward_numbers
      const { rows } = await pool.query(
        'SELECT user_id FROM call_forward_numbers WHERE twilio_number = $1 ORDER BY created_at DESC LIMIT 1',
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
    } catch (err) {
      console.error('Error during call event logging', err);
    }
  })();

  // trigger web push notification asynchronously (do not block response)
  try {
    sendPush().catch((err) => {
      console.error('Failed to send push notification', err);
    });
  } catch (err) {
    console.error('Failed to initiate push', err);
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
