import type { NextApiRequest, NextApiResponse } from "next";
import { Twilio } from "twilio";
import { Pool } from "@neondatabase/serverless";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  /* ===============================
   * ENV VALIDATION
   * =============================== */
  const databaseUrl =
    process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!databaseUrl) {
    return res.status(500).json({
      error: "DATABASE_URL / POSTGRES_URL not configured",
    });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return res.status(500).json({
      error: "Twilio credentials not configured",
    });
  }

  // 🔒 반드시 환경변수에서만 Voice Webhook URL 사용
  const voiceWebhookUrl = process.env.TWILIO_VOICE_WEBHOOK_URL?.trim();

  if (!voiceWebhookUrl || !/^https:\/\/.+/i.test(voiceWebhookUrl)) {
    return res.status(500).json({
      error: "Invalid TWILIO_VOICE_WEBHOOK_URL",
      value: voiceWebhookUrl,
    });
  }

  /* ===============================
   * CLIENTS
   * =============================== */
  const pool = new Pool({ connectionString: databaseUrl });
  const twilio = new Twilio(accountSid, authToken);

  try {
    /* ===============================
     * 1) ACTIVE SUBSCRIPTIONS
     * =============================== */
    const { rows: subs } = await pool.query<{
      user_id: string;
      current_period_end: string;
    }>(`
      SELECT user_id, current_period_end
      FROM subscriptions
      WHERE status = 'active'
        AND current_period_end > NOW()
        AND user_id IS NOT NULL
    `);

    if (subs.length === 0) {
      return res.status(200).json({
        ok: true,
        message: "No active subscribers",
      });
    }

    let purchased = 0;
    let reused = 0;
    let updatedExpiry = 0;

    /* ===============================
     * 2) PROCESS USERS
     * =============================== */
    for (const sub of subs) {
      const userId = sub.user_id;
      const expireAt = sub.current_period_end;
      const startAt = new Date().toISOString(); // ✅ start_at 명시

      /* ---- reuse existing number ---- */
      const { rows: existing } = await pool.query<{
        id: string;
        expire_at: string | null;
      }>(
        `
        SELECT id, expire_at
        FROM call_forward_numbers
        WHERE user_id = $1
          AND is_released = false
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        [userId]
      );

      if (existing.length > 0) {
        reused++;

        const row = existing[0];
        if (!row.expire_at || new Date(row.expire_at) < new Date(expireAt)) {
          await pool.query(
            `
            UPDATE call_forward_numbers
            SET expire_at = $2,
                updated_at = NOW()
            WHERE id = $1
            `,
            [row.id, expireAt]
          );
          updatedExpiry++;
        }

        continue;
      }

      /* ---- buy new number ---- */
      const available = await twilio
        .availablePhoneNumbers("US")
        .local.list({
          voiceEnabled: true,
          limit: 1,
        });

      if (available.length === 0) {
        console.warn(
          "[assign-number] No available numbers for user",
          userId
        );
        continue;
      }

      const numberToBuy = available[0].phoneNumber;

      const purchasedNumber =
        await twilio.incomingPhoneNumbers.create({
          phoneNumber: numberToBuy,
          voiceUrl: voiceWebhookUrl,
          voiceMethod: "POST",
        });

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
          startAt,   // ✅ NOT NULL
          expireAt,
        ]
      );

      purchased++;
    }

    return res.status(200).json({
      ok: true,
      processed: subs.length,
      purchased,
      reused,
      updatedExpiry,
      voiceWebhookUrl,
    });
  } catch (err: any) {
    console.error("[assign-number] fatal:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}
