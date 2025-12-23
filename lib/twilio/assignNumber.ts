import { Pool } from '@neondatabase/serverless';
import { Twilio } from 'twilio';

export interface AssignTwilioNumberParams {
  userId: string;
  expireAt: Date;
  traceId?: string;
}

export interface AssignTwilioNumberResult {
  reused: boolean;
  purchased: boolean;
  twilioSid: string | null;
  twilioNumber: string | null;
}

export async function assignTwilioNumberForUser({ userId, expireAt, traceId }: AssignTwilioNumberParams): Promise<AssignTwilioNumberResult> {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL/POSTGRES_URL not configured');
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const voiceWebhookUrl = process.env.TWILIO_VOICE_WEBHOOK_URL?.trim();

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured');
  }
  if (!voiceWebhookUrl || !/^https:\/\/.+/i.test(voiceWebhookUrl)) {
    throw new Error('Invalid TWILIO_VOICE_WEBHOOK_URL');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const twilio = new Twilio(accountSid, authToken);

  try {
    await pool.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [userId]);
  } catch (err) {
    console.error('[assignTwilioNumberForUser] Failed to acquire advisory lock', { traceId, userId, err });
  }

  const { rows: existingRows } = await pool.query<{ id: string; expire_at: string | null; twilio_sid: string; twilio_number: string }>(
    `
      SELECT id, expire_at, twilio_sid, twilio_number
      FROM call_forward_numbers
      WHERE user_id = $1
        AND is_released = false
        AND expire_at > NOW()
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [userId]
  );

  if (existingRows.length > 0) {
    const row = existingRows[0];
    if (!row.expire_at || new Date(row.expire_at) < expireAt) {
      await pool.query(
        `
        UPDATE call_forward_numbers
        SET expire_at = $2,
            updated_at = NOW()
        WHERE id = $1
        `,
        [row.id, expireAt.toISOString()]
      );
    }
    return {
      reused: true,
      purchased: false,
      twilioSid: row.twilio_sid,
      twilioNumber: row.twilio_number,
    };
  }

  let purchasedNumber: any;
  try {
    const available = await twilio.availablePhoneNumbers('US').local.list({
      voiceEnabled: true,
      limit: 1,
    });

    if (!available || available.length === 0) {
      throw new Error('No available phone numbers');
    }

    const numberToBuy = available[0].phoneNumber;
    purchasedNumber = await twilio.incomingPhoneNumbers.create({
      phoneNumber: numberToBuy,
      voiceUrl: voiceWebhookUrl,
      voiceMethod: 'POST',
    });
  } catch (err) {
    console.error('[assignTwilioNumberForUser] Twilio purchase failed', { traceId, userId, err });
    throw err;
  }

  const startAt = new Date();
  try {
    await pool.query(
      `
      INSERT INTO call_forward_numbers
        (
          user_id,
          twilio_number,
          twilio_sid,
          start_at,
          expire_at,
          is_released,
          created_at,
          updated_at
        )
      VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          false,
          NOW(),
          NOW()
        )
      `,
      [
        userId,
        purchasedNumber.phoneNumber,
        purchasedNumber.sid,
        startAt.toISOString(),
        expireAt.toISOString(),
      ]
    );
    return {
      reused: false,
      purchased: true,
      twilioSid: purchasedNumber.sid,
      twilioNumber: purchasedNumber.phoneNumber,
    };
  } catch (err) {
    console.error('[assignTwilioNumberForUser] DB insert failed, releasing number', { traceId, userId, err });
    try {
      await twilio.incomingPhoneNumbers(purchasedNumber.sid).remove();
      console.log('[assignTwilioNumberForUser] Released Twilio number due to DB failure', { traceId, userId, sid: purchasedNumber.sid });
    } catch (releaseErr) {
      console.error('[assignTwilioNumberForUser] Failed to release Twilio number', { traceId, userId, sid: purchasedNumber.sid, releaseErr });
    }
    throw new Error('DB insert failed');
  }
}
