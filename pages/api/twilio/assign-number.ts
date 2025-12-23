import type { NextApiRequest, NextApiResponse } from "next";
import { Pool } from "@neondatabase/serverless";
import { assignTwilioNumberForUser } from "../../../lib/twilio/assignNumber";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) {
    return res.status(500).json({ error: "DATABASE_URL / POSTGRES_URL not configured" });
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const { rows: subs } = await pool.query<{ user_id: string; current_period_end: string }>(
      `
      SELECT user_id, current_period_end
      FROM subscriptions
      WHERE status = 'active'
        AND current_period_end > NOW()
        AND user_id IS NOT NULL
        AND btrim(user_id::text) <> ''
    `
    );

    if (subs.length === 0) {
      return res.status(200).json({ ok: true, message: "No active subscribers" });
    }

    let purchased = 0;
    let reused = 0;

    for (const sub of subs) {
      const userId = sub.user_id;
      const expireAt = new Date(sub.current_period_end);
      try {
        const result = await assignTwilioNumberForUser({ userId, expireAt });
        if (result.reused) {
          reused++;
        } else if (result.purchased) {
          purchased++;
        }
      } catch (err) {
        console.error("[api/twilio/assign-number] assign failed", { userId, err });
      }
    }

    return res.status(200).json({
      ok: true,
      processed: subs.length,
      purchased,
      reused,
    });
  } catch (err) {
    console.error("[api/twilio/assign-number] fatal:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
