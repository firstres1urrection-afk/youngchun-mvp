import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { sql } from "@vercel/postgres";

export const config = {
  api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

async function buffer(readable: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function toTimestamptz(epochSeconds: number | null | undefined) {
  if (!epochSeconds) return null;
  // Postgres timestamptz expects Date; we can send ISO string.
  return new Date(epochSeconds * 1000).toISOString();
}

async function upsertSubscription(params: {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  userId: string | null; // uuid string or null
}) {
  const { stripeSubscriptionId, stripeCustomerId, status, currentPeriodStart, currentPeriodEnd, userId } = params;

  await sql`
    INSERT INTO subscriptions (
      stripe_subscription_id,
      stripe_customer_id,
      user_id,
      status,
      current_period_start,
      current_period_end,
      created_at,
      updated_at
    )
    VALUES (
      ${stripeSubscriptionId},
      ${stripeCustomerId},
      ${userId},
      ${status ?? "active"},
      ${currentPeriodStart},
      ${currentPeriodEnd},
      NOW(),
      NOW()
    )
    ON CONFLICT (stripe_subscription_id)
    DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      status = COALESCE(EXCLUDED.status, subscriptions.status),
      current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
      current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
      user_id = COALESCE(EXCLUDED.user_id, subscriptions.user_id),
      updated_at = NOW();
  `;
}

async function updateUserIdBySubscription(stripeSubscriptionId: string, userId: string) {
  await sql`
    UPDATE subscriptions
    SET user_id = ${userId}, updated_at = NOW()
    WHERE stripe_subscription_id = ${stripeSubscriptionId};
  `;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  if (!webhookSecret) return res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

  let event: Stripe.Event;

  try {
    const buf = await buffer(req);
    const sig = req.headers["stripe-signature"];
    if (!sig || Array.isArray(sig)) return res.status(400).send("Missing Stripe-Signature header");
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err: any) {
    console.error("[stripe-webhook] signature verification failed:", err?.message);
    return res.status(400).send(`Webhook Error: ${err?.message ?? "Unknown error"}`);
  }

  try {
    // ✅ SSOT: customer.subscription.* drives status/period in DB
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;

      const stripeSubscriptionId = sub.id;
      const stripeCustomerId = sub.customer as string;
      const status = sub.status ?? null;

      const item = sub.items?.data?.[0] as any;

const itemCps = item?.current_period_start as number | undefined;
const itemCpe = item?.current_period_end as number | undefined;

const currentPeriodStart = toTimestamptz(
  (sub.current_period_start ?? itemCps) ?? null
);
const currentPeriodEnd = toTimestamptz(
  (sub.current_period_end ?? itemCpe) ?? null
);

      const metaUserIdRaw = (sub.metadata?.userId as string | undefined) ?? undefined;
      const userId = isUuid(metaUserIdRaw) ? metaUserIdRaw : null;

      console.log(`[stripe-webhook] ${event.type}`, {
        stripeSubscriptionId,
        stripeCustomerId,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        userId,
      });

      await upsertSubscription({
        stripeSubscriptionId,
        stripeCustomerId,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        userId,
      });

      return res.status(200).json({ received: true });
    }

    // ✅ checkout.session.completed is a helper: only map userId if possible, do not fail the webhook
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const stripeSubscriptionId = (session.subscription as string | null) ?? null;
      const stripeCustomerId = (session.customer as string | null) ?? null;
      const metaUserIdRaw = (session.metadata?.userId as string | undefined) ?? undefined;
      const userId = isUuid(metaUserIdRaw) ? metaUserIdRaw : null;

      console.log("[stripe-webhook] checkout.session.completed", {
        sessionId: session.id,
        stripeSubscriptionId,
        stripeCustomerId,
        userId,
        payment_status: session.payment_status,
      });

      // if we can, map user_id to existing row; if row doesn't exist yet, upsert minimal (status/period will be overwritten by subscription events)
      if (stripeSubscriptionId && stripeCustomerId) {
        if (userId) {
          await upsertSubscription({
            stripeSubscriptionId,
            stripeCustomerId,
            status: "active",
            currentPeriodStart: null,
            currentPeriodEnd: null,
            userId,
          });
        } else {
          // keep it minimal; don't force user_id
          await upsertSubscription({
            stripeSubscriptionId,
            stripeCustomerId,
            status: "active",
            currentPeriodStart: null,
            currentPeriodEnd: null,
            userId: null,
          });
        }
      }

      return res.status(200).json({ received: true });
    }

    console.log("[stripe-webhook] unhandled event:", event.type);
    return res.status(200).json({ received: true });
  } catch (err: any) {
    // IMPORTANT: avoid causing Stripe endless retries unless we really want it.
    console.error("[stripe-webhook] handler failed:", err?.message);
    return res.status(200).json({ received: true, warning: "handler_failed_logged" });
  }
}
