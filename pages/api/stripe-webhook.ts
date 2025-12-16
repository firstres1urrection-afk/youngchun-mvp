import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { buffer } from 'micro';
import { sql } from '@vercel/postgres';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = session.subscription as string | null;
      const customerId = session.customer as string | null;
      if (subscriptionId && customerId) {
        await sql`
          INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, status, created_at, updated_at)
          VALUES (${subscriptionId}, ${customerId}, 'active', NOW(), NOW())
          ON CONFLICT (stripe_subscription_id)
          DO UPDATE SET status = 'active', updated_at = NOW();
        `;
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const subscriptionId = subscription.id;
      const customerId = subscription.customer as string;
      if (subscriptionId && customerId) {
        await sql`
          INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, status, created_at, updated_at)
          VALUES (${subscriptionId}, ${customerId}, 'canceled', NOW(), NOW())
          ON CONFLICT (stripe_subscription_id)
          DO UPDATE SET status = 'canceled', updated_at = NOW();
        `;
      }
      break;
    }
    default:
      break;
  }

  res.status(200).json({ received: true });
}
