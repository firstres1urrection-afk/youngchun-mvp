import type { NextApiRequest, NextApiResponse } from 'next';
import { twiml } from 'twilio';
import { sql } from '@vercel/postgres';
import { sendPush } from '../../../lib/push/sendPush';

// Twilio uses urlencoded by default; disable bodyParser to get raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

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

  // quietly record call event in database
  try {
    // ensure extension and table exist
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;
    await sql`CREATE TABLE IF NOT EXISTS call_events (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      call_sid text NOT NULL,
      from_number text,
      to_number text,
      created_at timestamp with time zone DEFAULT now()
    );`;
    if (callSid) {
      await sql`INSERT INTO call_events (call_sid, from_number, to_number) VALUES (${callSid}, ${from}, ${to});`;
    }
  } catch (err) {
    console.error('Failed to record call event', err);
  }

  // trigger web push notification asynchronously (do not block response)
  try {
    // call sendPush without awaiting so that TwiML response isn't delayed
    sendPush().catch((err) => {
      console.error('Failed to send push notification', err);
    });
  } catch (err) {
    console.error('Failed to initiate push', err);
  }

  const response = new twiml.VoiceResponse();
  const message = '지금 해외 체류 중이라 전화를 받을 수 없습니다. 잠시 후 다시 연락드리겠습니다.';
  response.say({ language: 'ko-KR' }, message);
  response.pause();
  response.say({ language: 'ko-KR' }, message);

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(response.toString());
}
