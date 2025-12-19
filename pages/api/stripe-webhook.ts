import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { sql } from '@vercel/postgres';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2024-06-20',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

/**
 * Read raw body for Stripe signature verification
 */
async function buffer(readable: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
        const {
          id: subscription_id,
          customer,
          status,
          current_period_start,
          current_period_end,
          cancel_at_period_end,
        } = sub;

        // Upsert into subscriptions table using top-level current_period_start/end
        await sql`
          INSERT INTO subscriptions (id, customer_id, status, current_period_start, current_period_end, cancel_at_period_end)
          VALUES (${subscription_id}, ${customer as string}, ${status}, to_timestamp(${current_period_start}), to_timestamp(${current_period_end}), ${cancel_at_period_end})
          ON CONFLICT (id) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            status = EXCLUDED.status,
            current_period_start = EXCLUDED.current_period_start,
            current_period_end = EXCLUDED.current_period_end,
            cancel_at_period_end = EXCLUDED.cancel_at_period_end;
        `;
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string | null;
        if (subscriptionId) {
          await sql`
            INSERT INTO subscriptions (id, status)
            VALUES (${subscriptionId}, 'active')
            ON CONFLICT (id) DO UPDATE SET status = 'active';
          `;
        }
        break;
      }

      case 'checkout.session.completed': {
        // Use metadata for user mapping if needed
        // No-op for now
        break;
      }

      default:
        // Unexpected event type; do nothing
        break;
    }
    res.json({ received: true });
  } catch (err: any) {
    console.error('Error handling webhook event:', err);
    res.status(500).send('Webhook handler failed');
  }
}

export default handler;
