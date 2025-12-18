import type { NextApiRequest, NextApiResponse } from "next";
import { Twilio } from "twilio";
import { Pool } from "@neondatabase/serverless";

/**
 * POST /api/twilio/assign-number
 *
 * Finds active subscribers (subscriptions.status='active' AND current_period_end > now()).
 * For each user:
 * - If an unreleased number exists (is_released=false), extend expire_at if needed.
 * - Else, buy a new Twilio US local number (voice-enabled), configure voice webhook,
 *   and insert into call_forward_numbers with is_released=false and expire_at=current_period_end.
 *
 * NOTE: This endpoint is intentionally admin-like. Do not expose publicly without protection.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) {
    return res.status(500).json({ error: "DB connection not configured (DATABASE_URL/POSTGRES_URL missing)" });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return res.status(500).json({ error: "Twilio credentials not configured" });
  }

  const baseUrl =
    (process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://youngchun-mvp.vercel.app").replace(/\/$/, "");
  const voiceWebhookUrl = process.env.TWILIO_VOICE_WEBHOOK_URL || `${baseUrl}/api/twilio/voice`; // 너 프로젝트에 맞게 필요시 변경

  const pool = new Pool({ connectionString: databaseUrl });
  const client = new Twilio(accountSid, authToken);

  try {
    // 1) active subscribers
    const { rows: subs } = await pool.query<{
      user_id: string;
      current_period_end: string; // timestamptz
    }>(
      `
      SELECT user_id, current_period_end
      FROM subscriptions
      WHERE status = 'active'
        AND current_period_end > NOW()
        AND user_id IS NOT NULL
      `
    );

    if (!subs.length) {
      return res.status(200).json({ ok: true, message: "No active subscribers", processed: 0 });
    }

    let purchased = 0;
    let reused = 0;
    let updatedExpiry = 0;

    // 2) process each active user
    for (const sub of subs) {
      const userId = sub.user_id;
      const expireAt = sub.current_period_end;

      // 2-a) check existing unreleased number for this user
      const { rows: existing } = await pool.query<{
        id: string;
        expire_at: string | null;
        twilio_number: string | null;
        twilio_sid: string | null;
      }>(
        `
        SELECT id, expire_at, twilio_number, twilio_sid
        FROM call_forward_numbers
        WHERE user_id = $1
          AND is_released = false
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        [userId]
      );

      if (existing.length > 0) {
        reused += 1;
        const row = existing[0];

        // extend expire_at if needed
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
          updatedExpiry += 1;
        }

        continue;
      }

      // 2-b) purchase a new number (voice enabled)
      // NOTE: Buying numbers costs money. This is why we only do it when none exists.
      const available = await client.availablePhoneNumbers("US").local.list({
        voiceEnabled: true,
        limit: 1,
      });

      if (!available || available.length === 0) {
        console.warn("[assign-number] No available phone numbers found for user:", userId);
        continue;
      }

      const numberToPurchase = available[0].phoneNumber;

      // Buy and set webhook
      const purchasedNumber = await client.incomingPhoneNumbers.create({
        phoneNumber: numberToPurchase,
        voiceUrl: voiceWebhookUrl,
        voiceMethod: "POST",
      });

      // 2-c) insert mapping
      await pool.query(
        `
        INSERT INTO call_forward_numbers
          (user_id, twilio_number, twilio_sid, expire_at, is_released, created_at, updated_at)
        VALUES
          ($1, $2, $3, $4, false, NOW(), NOW())
        `,
        [userId, purchasedNumber.phoneNumber, purchasedNumber.sid, expireAt]
      );

      purchased += 1;
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
    console.error("[assign-number] error:", err?.message || err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    // In serverless, pool.end() is optional; leaving it out avoids cold-start penalties sometimes.
    // If you see connection exhaustion, enable pool.end().
    // await pool.end();
  }
}
