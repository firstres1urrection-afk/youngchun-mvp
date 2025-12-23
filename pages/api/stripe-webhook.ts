import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { sql } from '@vercel/postgres';
import { assignTwilioNumberForUser } from '../../lib/twilio/assignNumber';

export const config = {
  api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2024-06-20',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

/** Read raw body for Stripe signature verification */
async function buffer(readable: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function isUuid(v: string | null | undefined): v is string {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig as string, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;

        const subscriptionId = sub.id;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

        // Stripe payload already contains userId in metadata (observed in Workbench)
        const metaUserId = (sub.metadata?.userId || sub.metadata?.user_id || null) as string | null;
        const userId = isUuid(metaUserId) ? metaUserId : null;

        // IMPORTANT: NEVER store 'active' here. Active is SSOT from invoice.payment_succeeded only.
        const safeStatus = 'pending';

        const cps = sub.current_period_start ?? null;
        const cpe = sub.current_period_end ?? null;

        await sql`
          INSERT INTO subscriptions (
            stripe_subscription_id,
            stripe_customer_id,
            user_id,
            status,
            current_period_start,
            current_period_end,
            updated_at
          )
          VALUES (
            ${subscriptionId},
            ${customerId ?? null},
            ${userId}::uuid,
            ${safeStatus},
            CASE WHEN ${cps} IS NULL THEN NULL ELSE to_timestamp(${cps}) END,
            CASE WHEN ${cpe} IS NULL THEN NULL ELSE to_timestamp(${cpe}) END,
            NOW()
          )
          ON CONFLICT (stripe_subscription_id) DO UPDATE SET
            stripe_customer_id = EXCLUDED.stripe_customer_id,
            user_id = COALESCE(EXCLUDED.user_id, subscriptions.user_id),
            status = EXCLUDED.status,
            current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
            current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
            updated_at = NOW();
        `;
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice.subscription as string | null) ?? null;

        if (subscriptionId) {
          // Try to update period end from invoice lines if present (optional)
          let periodEnd: number | null = null;
          try {
            const line: any = invoice.lines?.data?.[0] || null;
            periodEnd = line?.period?.end ?? null;
          } catch {
            periodEnd = null;
          }

          // Active promotion ONLY when user_id is present (NOT NULL and not empty)
          await sql`
            UPDATE subscriptions
            SET
              status = 'active',
              current_period_end = COALESCE(
                CASE WHEN ${periodEnd} IS NULL THEN NULL ELSE to_timestamp(${periodEnd}) END,
                current_period_end
              ),
              updated_at = NOW()
            WHERE stripe_subscription_id = ${subscriptionId}
              AND user_id IS NOT NULL
              AND btrim(user_id::text) <> '';
          `;

          // Safety net: invalidate any user_id-less active rows (NULL or empty)
          await sql`
            UPDATE subscriptions
            SET status = 'invalid',
                updated_at = NOW()
            WHERE status = 'active'
              AND (user_id IS NULL OR btrim(user_id::text) = '');
          `;

          // -------- Twilio assignment with idempotency ---------
          // Ensure billing_events table exists
          await sql`
            CREATE TABLE IF NOT EXISTS billing_events (
              event_id TEXT PRIMARY KEY,
              created_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
          `;
          // Check if event already processed
          const { rows: existing } = await sql`
            SELECT event_id FROM billing_events WHERE event_id = ${event.id};
          `;
          if (existing.length === 0) {
            // Insert event id to mark as processed
            await sql`
              INSERT INTO billing_events (event_id) VALUES (${event.id});
            `;

            // Fetch subscription row to verify conditions
            const { rows: subs } = await sql`
              SELECT user_id, current_period_end
              FROM subscriptions
              WHERE stripe_subscription_id = ${subscriptionId}
                AND status = 'active'
                AND current_period_end > NOW()
                AND user_id IS NOT NULL
                AND btrim(user_id::text) <> '';
            `;
            if (subs.length > 0) {
              const userId = subs[0].user_id as string;
              const expireAt = new Date(subs[0].current_period_end as unknown as string);
              try {
                const result = await assignTwilioNumberForUser({ userId, expireAt });
                console.log(JSON.stringify({
                  trace_id: event.id,
                  subscription_id: subscriptionId,
                  user_id: userId,
                  reused: result.reused,
                  purchased: result.purchased,
                  twilio_sid: result.twilioSid,
                }));
              } catch (assignErr: any) {
                console.error('assignTwilioNumberForUser error:', assignErr);
                // If error thrown, optionally remove billing_events row so stripe retry will reprocess
                try {
                  await sql`DELETE FROM billing_events WHERE event_id = ${event.id};`;
                } catch (delErr: any) {
                  console.error('failed to cleanup billing_events after error', delErr);
                }
                throw assignErr;
              }
            } else {
              console.log(JSON.stringify({ trace_id: event.id, reason: 'no_active_subscription' }));
            }
          } else {
            console.log(JSON.stringify({ trace_id: event.id, reason: 'already_processed' }));
          }
          // ------------------------------------------------------
        }
        break;
      }

      case 'checkout.session.completed': {
        // Intentionally no-op. (We rely on invoice.payment_succeeded as SSOT)
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error('Error handling webhook event:', err);
    return res.status(500).send('Webhook handler failed');
  }
}
