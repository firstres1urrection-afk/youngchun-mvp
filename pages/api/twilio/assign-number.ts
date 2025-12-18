import type { NextApiRequest, NextApiResponse } from 'next';
import { Twilio } from 'twilio';
import { Pool } from '@neondatabase/serverless';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL as string });

  try {
    // Fetch active subscriptions
    const { rows: subs } = await pool.query(
      `SELECT user_id, current_period_end FROM subscriptions WHERE status = 'active' AND current_period_end > NOW()`
    );

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const webhookUrl =
      process.env.TWILIO_VOICE_WEBHOOK_URL ||
      `${process.env.BASE_URL || ''}/api/voice/webhook`;

    if (!accountSid || !authToken) {
      return res.status(500).json({ error: 'Twilio credentials not configured' });
    }

    const client = new Twilio(accountSid, authToken);

    for (const sub of subs) {
      const userId = sub.user_id;
      const expiresAt = sub.current_period_end;

      // Check for existing active number
      const { rows: existing } = await pool.query(
        `SELECT id, expires_at FROM call_forward_numbers WHERE user_id = $1 AND status = 'active' LIMIT 1`,
        [userId]
      );

      if (existing.length > 0) {
        const existingRow = existing[0];
        // Update expires_at if later
        if (new Date(existingRow.expires_at) < new Date(expiresAt)) {
          await pool.query(
            `UPDATE call_forward_numbers SET expires_at = $2, updated_at = NOW() WHERE id = $1`,
            [existingRow.id, expiresAt]
          );
        }
        continue;
      }

      // Purchase new phone number
      try {
        const available = await client.availablePhoneNumbers('US').local.list({
          voiceEnabled: true,
          limit: 1,
        });

        if (!available || available.length === 0) {
          console.warn('No available phone numbers found for user', userId);
          continue;
        }

        const numberToPurchase = available[0].phoneNumber;

        const purchased = await client.incomingPhoneNumbers.create({
          phoneNumber: numberToPurchase,
          voiceUrl: webhookUrl,
        });

        await pool.query(
          `INSERT INTO call_forward_numbers (user_id, phone_number, twilio_sid, status, expires_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'active', $4, NOW(), NOW())`,
          [userId, purchased.phoneNumber, purchased.sid, expiresAt]
        );
      } catch (purchaseErr) {
        console.error('Error purchasing number for user', userId, purchaseErr);
        // Skip, do not partially insert
        continue;
      }
    }

    res.status(200).json({ success: true, processed: subs.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    await pool.end();
  }
}
