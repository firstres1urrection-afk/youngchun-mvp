// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@vercel/postgres';
const twilio = require('twilio');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end('Method Not Allowed');
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return res.status(500).json({ ok: false, error: 'Twilio credentials missing' });
  }
  const client = twilio(accountSid, authToken);

  try {
    const { rows } = await sql`SELECT id, twilio_sid, twilio_number FROM call_forward_numbers WHERE expire_at < NOW() AND is_released = false`;
    let released = 0;
    for (const row of rows) {
      try {
        await client.incomingPhoneNumbers(row.twilio_sid).remove();
        await sql`UPDATE call_forward_numbers SET is_released = true WHERE id = ${row.id}`;
        released += 1;
        console.log(`Released number ${row.twilio_number} (${row.twilio_sid})`);
      } catch (err) {
        console.error(`Error releasing number ${row.twilio_number} (${row.twilio_sid}):`, err);
      }
    }
    return res.status(200).json({ ok: true, released });
  } catch (err: any) {
    console.error('Error releasing expired numbers:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// test deploy
// test after connect

