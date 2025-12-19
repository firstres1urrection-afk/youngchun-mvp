import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { sql } from "@vercel/postgres";

export const config = {
  api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

/**
 * Read raw body for Stripe signature verification
 */
async function buffer(readable: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

function toTimestamptz(epochSeconds?: number | null) {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

async function upsertSubscription(params: {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  userId: string | null;
}) {
  const {
    stripeSubscriptionId,
    stripeCustomerId,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    userId,
  } = params;

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  if (!webhookSecret || !process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Stripe env not configured" });
  }

  let event: Stripe.Event;

  try {
    const buf = await buffer(req);
    const sig = req.headers["stripe-signature"];
    if (!sig || Array.isArray(sig)) {
      return res.status(400).send("Missing Stripe-Signature");
    }

    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err: any) {
    console.error("[stripe-webhook] signature verification failed:", err?.message);
    return res.status(400).send("Webhook signature verification failed");
  }

  try {
    /**
     * 🔹 subscription lifecycle events (SSOT)
     */
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;

      const item = sub.items?.data?.[0];

      await upsertSubscription({
        stripeSubscriptionId: sub.id,
        stripeCustomerId: sub.customer as string,
        status: sub.status ?? null,
        currentPeriodStart: toTimestamptz(
          sub.current_period_start ?? item?.current_period_start
        ),
        currentPeriodEnd: toTimestamptz(
          sub.current_period_end ?? item?.current_period_end
        ),
        userId: isUuid(sub.metadata?.userId) ? sub.metadata.userId : null,
      });

      return res.status(200).json({ received: true });
    }

    /**
     * 🔹 checkout.session.completed (userId mapping helper)
     */
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const subscriptionId = session.subscription as string | null;
      const customerId = session.customer as string | null;
      const userId = isUuid(session.metadata?.userId)
        ? session.metadata!.userId
        : null;

      if (subscriptionId && customerId) {
        await upsertSubscription({
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: customerId,
          status: "active",
          currentPeriodStart: null,
          currentPeriodEnd: null,
          userId,
        });
      }

      return res.status(200).json({ received: true });
    }

    /**
     * 🔹 invoice.payment_succeeded (activate subscription)
     */
    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;

      if (invoice.subscription && invoice.customer) {
        await upsertSubscription({
          stripeSubscriptionId: invoice.subscription as string,
          stripeCustomerId: invoice.customer as string,
          status: "active",
          currentPeriodStart: null,
          currentPeriodEnd: null,
          userId: null,
        });
      }

      return res.status(200).json({ received: true });
    }

    // unhandled but acknowledged
    console.log("[stripe-webhook] unhandled event:", event.type);
    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("[stripe-webhook] handler failed:", err?.message);
    return res.status(200).json({ received: true });
  }
}
