import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@vercel/postgres';
import twilio from 'twilio';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error('Twilio credentials not configured');
    return res.status(500).json({ message: 'Twilio credentials not configured' });
  }

  const client = twilio(accountSid, authToken);

  try {
    const { rows } = await sql`SELECT * FROM call_forward_numbers WHERE expire_at < NOW() AND is_released = false;`;
    let releasedCount = 0;

    for (const row of rows) {
      try {
        // Attempt to get phone SID from possible columns
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let phoneSid: string | null = (row as any).twilio_sid || (row as any).phone_sid || null;

        if (!phoneSid && (row as any).twilio_number) {
          const phones = await client.incomingPhoneNumbers.list({ phoneNumber: (row as any).twilio_number, limit: 1 });
          if (phones && phones.length > 0) {
            phoneSid = phones[0].sid;
          }
        }

        if (phoneSid) {
          await client.incomingPhoneNumbers(phoneSid).remove();
          console.log(`Released Twilio number: ${phoneSid} (${(row as any).twilio_number})`);
        } else {
          console.warn(`Phone SID not found for number: ${(row as any).twilio_number}`);
          continue;
        }

        // Update database to mark as released
        await sql`UPDATE call_forward_numbers SET is_released = true WHERE id = ${row.id};`;
        releasedCount++;
      } catch (err) {
        console.error('Error releasing number', (row as any).twilio_number, err);
      }
    }

    return res.status(200).json({ releasedCount });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
