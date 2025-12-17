// pages/api/stripe-webhook.ts

import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { sql } from "@vercel/postgres";

// ✅ Stripe 서명 검증을 위해 반드시 raw body를 받아야 함
export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

// raw body 읽기 유틸
async function buffer(readable: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  if (!webhookSecret) {
    return res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
  }

  let event: Stripe.Event;

  try {
    const buf = await buffer(req);

    const sig = req.headers["stripe-signature"];
    if (!sig || Array.isArray(sig)) {
      return res.status(400).send("Missing Stripe-Signature header");
    }

    // ✅ 여기서 서명 검증 통과해야 함
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err: any) {
    console.error("[stripe-webhook] signature verification failed:", err?.message);
    return res.status(400).send(`Webhook Error: ${err?.message ?? "Unknown error"}`);
  }

  try {
    switch (event.type) {
      // ✅ Checkout 완료 시 구독ID/고객ID 확보 → DB active upsert
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const subscriptionId = (session.subscription as string | null) ?? null;
        const customerId = (session.customer as string | null) ?? null;

        console.log("[stripe-webhook] checkout.session.completed", {
          sessionId: session.id,
          subscriptionId,
          customerId,
        });

        if (subscriptionId && customerId) {
          await sql`
            INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, status, created_at, updated_at)
            VALUES (${subscriptionId}, ${customerId}, 'active', NOW(), NOW())
            ON CONFLICT (stripe_subscription_id)
            DO UPDATE SET
              stripe_customer_id = EXCLUDED.stripe_customer_id,
              status = 'active',
              updated_at = NOW();
          `;
        }

        break;
      }

      // ✅ 구독이 삭제(해지)되면 canceled 처리
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        const subscriptionId = subscription.id;
        const customerId = subscription.customer as string;

        console.log("[stripe-webhook] customer.subscription.deleted", {
          subscriptionId,
          customerId,
          status: subscription.status,
        });

        if (subscriptionId && customerId) {
          await sql`
            INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, status, created_at, updated_at)
            VALUES (${subscriptionId}, ${customerId}, 'canceled', NOW(), NOW())
            ON CONFLICT (stripe_subscription_id)
            DO UPDATE SET
              stripe_customer_id = EXCLUDED.stripe_customer_id,
              status = 'canceled',
              updated_at = NOW();
          `;
        }

        break;
      }

      default:
        console.log("[stripe-webhook] unhandled event type:", event.type);
        break;
    }

    // ✅ Stripe에 2xx 응답을 줘야 재시도 멈춤
    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("[stripe-webhook] handler failed:", err?.message);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}
