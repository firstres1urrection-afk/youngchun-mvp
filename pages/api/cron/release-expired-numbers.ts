// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@vercel/postgres';
const twilio = require('twilio');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET or POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end('Method Not Allowed');
  }

  // Twilio credentials
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return res.status(500).json({ ok: false, error: 'Twilio credentials missing' });
  }

  const client = twilio(accountSid, authToken);

  try {
    // Fetch expired numbers that have not been released yet
    const { rows } = await sql`
      SELECT id, twilio_number_sid, phone_number
      FROM call_forward_numbers
      WHERE expire_at < NOW()
        AND is_released = false
        AND expire_at IS NOT NULL
    `;

    let released = 0;

    for (const row of rows) {
      // Attempt to release the number on Twilio side; don't stop on failure
      try {
        await client.incomingPhoneNumbers(row.twilio_number_sid).remove();
        console.log(`Released Twilio number on Twilio side: ${row.phone_number} (${row.twilio_number_sid})`);
      } catch (err) {
        console.error(`Error releasing number on Twilio side ${row.phone_number} (${row.twilio_number_sid}):`, err);
      }

      // Update the database to mark the number as released and set released_at
      try {
        await sql`
          UPDATE call_forward_numbers
          SET is_released = true,
              released_at = NOW()
          WHERE id = ${row.id}
        `;
        released += 1;
      } catch (err) {
        console.error(`Error updating DB for number ${row.phone_number} (${row.twilio_number_sid}):`, err);
      }
    }

    // Respond with how many numbers were checked and released
    return res.status(200).json({
      ok: true,
      checked: rows.length,
      released,
    });
  } catch (err: any) {
    console.error('Error releasing expired numbers:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
