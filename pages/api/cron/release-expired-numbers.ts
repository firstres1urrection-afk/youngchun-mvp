// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
const twilio = require('twilio');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET or POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end('Method Not Allowed');
  }

  // Cron secret check
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = (req.headers['x-cron-secret'] as string) || (req.query.token as string);
  if (cronSecret && providedSecret !== cronSecret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Twilio credentials
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return res.status(500).json({ ok: false, error: 'Twilio credentials missing' });
  }

  // Database URL
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) {
    return res.status(500).json({ ok: false, error: 'Database URL not configured' });
  }

  const client = twilio(accountSid, authToken);
  const pool = new Pool({ connectionString: databaseUrl });

  let processed = 0;
  let releasedCount = 0;
  let failedTwilio = 0;
  let failedDb = 0;
  const results: any[] = [];

  try {
    // Fetch expired numbers that have not been released yet
    const { rows } = await pool.query(`
      SELECT id, twilio_number AS phone_number, twilio_sid
      FROM call_forward_numbers
      WHERE is_released = false
        AND expire_at IS NOT NULL
        AND expire_at < NOW()
        AND twilio_sid IS NOT NULL
    `);

    processed = rows.length;

    for (const row of rows) {
      const id = row.id;
      const sid = row.twilio_sid;
      let status: string = '';
      let error: string | undefined;

      try {
        // Attempt to release the number on Twilio side; don't stop on failure
        await client.incomingPhoneNumbers(sid).remove();

        // Twilio release succeeded; update DB to mark released
        try {
          await pool.query(
            'UPDATE call_forward_numbers SET is_released = true, released_at = NOW(), updated_at = NOW() WHERE id = $1',
            [id],
          );
          status = 'released';
          releasedCount += 1;
        } catch (dbError: any) {
          // Twilio release succeeded but DB update failed
          status = 'failed_db';
          error = dbError?.message || 'DB update failed';
          failedDb += 1;
        }
      } catch (twilioError: any) {
        // Twilio release failed; do not mark as released
        status = 'failed_twilio';
        error = twilioError?.message || 'Twilio release failed';
        failedTwilio += 1;

        // Optionally update updated_at to reflect attempted release
        try {
          await pool.query(
            'UPDATE call_forward_numbers SET updated_at = NOW() WHERE id = $1',
            [id],
          );
        } catch {
          // ignore DB errors here
        }
      }

      if (results.length < 20) {
        results.push({
          id,
          twilio_sid: sid,
          status,
          error,
        });
      }
    }

    const responseBody = {
      ok: true,
      processed,
      released: releasedCount,
      failed_twilio: failedTwilio,
      failed_db: failedDb,
      results,
    };

    // Log summary once line to Vercel logs
    console.log(
      JSON.stringify({
        ok: responseBody.ok,
        processed: responseBody.processed,
        released: responseBody.released,
        failed_twilio: responseBody.failed_twilio,
        failed_db: responseBody.failed_db,
      }),
    );

    return res.status(200).json(responseBody);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
  } finally {
    await pool.end();
  }
}
