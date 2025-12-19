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
      SELECT id, twilio_number AS phone_number, twilio_sid
      FROM call_forward_numbers
      WHERE is_released = false
        AND expire_at IS NOT NULL
        AND expire_at < NOW()
        AND twilio_sid IS NOT NULL
    `;

    const processed = rows.length;
    let releasedCount = 0;
    let failedCount = 0;
    const results: any[] = [];

    for (const row of rows) {
      const phoneNumber = row.phone_number;
      const sid = row.twilio_sid;
      let status: string = 'skipped';
      let error: string | undefined;

      // Attempt to release the number on Twilio side; don't stop on failure
      try {
        await client.incomingPhoneNumbers(sid).remove();
        status = 'released';
      } catch (err: any) {
        status = 'failed';
        error = err?.message || String(err);
      }

      // Update the database to mark the number as released
      try {
        await sql`
          UPDATE call_forward_numbers
          SET is_released = true,
              updated_at = NOW()
          WHERE id = ${row.id}
        `;
      } catch (err2: any) {
        status = 'failed';
        const dbErr = err2?.message || String(err2);
        error = error ? `${error}; DB update failed: ${dbErr}` : `DB update failed: ${dbErr}`;
      }

      if (status === 'released') {
        releasedCount++;
      } else if (status === 'failed') {
        failedCount++;
      }

      results.push({ phone_number: phoneNumber, twilio_sid: sid, status, error });
    }

    return res.status(200).json({
      ok: true,
      processed,
      released: releasedCount,
      failed: failedCount,
      results,
    });
  } catch (err: any) {
    console.error('Error releasing expired numbers:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
