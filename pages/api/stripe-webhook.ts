import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { buffer } from 'micro';
import { sql } from '@vercel/postgres';
const twilio = require('twilio');

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2025-11-17.clover',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

// Helper to map price (in currency units) to number of days
function priceToDays(amount: number): number | null {
  switch (amount) {
    case 3:
      return 3;
    case 7:
      return 7;
    case 14:
      return 14;
    case 30:
      return 30;
    default:
      return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  let buf: Buffer;
  try {
    buf = await buffer(req);
  } catch (err) {
    console.error('Error reading raw body:', err);
    return res.status(400).send(`Webhook Error: Unable to read body`);
  }

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
      try {
        // Determine total amount in currency units; Stripe returns amount_total in cents
        const amountTotal = ((session.amount_total ?? 0) / 100);
        const days = priceToDays(amountTotal);
        if (!days) {
          console.error(`priceToDays: unknown amount ${amountTotal}, skipping Twilio purchase.`);
          break;
        }
        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
        console.log(`Checkout session completed. Creating number for ${days} days from ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Purchase a Twilio number
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!accountSid || !authToken) {
          throw new Error('Twilio credentials not provided');
        }
        const client = twilio(accountSid, authToken);
        const available = await client.availablePhoneNumbers('US').local.list({
          smsEnabled: true,
          voiceEnabled: true,
          limit: 1,
        });
        if (!available || available.length === 0) {
          throw new Error('No available Twilio numbers found');
        }
        const candidate = available[0];
        const voiceUrl = process.env.TWILIO_VOICE_URL || `${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/twilio-callback`;
        const smsUrl = process.env.TWILIO_SMS_URL || `${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/twilio-callback`;
        const purchased = await client.incomingPhoneNumbers.create({
          phoneNumber: candidate.phoneNumber,
          voiceUrl,
          smsUrl,
        });

        const userId = session.customer ?? session.id;
        // Insert into Postgres table
        await sql`
          INSERT INTO call_forward_numbers (user_id, twilio_number, twilio_sid, start_at, expire_at, is_released)
          VALUES (${userId}, ${purchased.phoneNumber}, ${purchased.sid}, ${startDate.toISOString()}, ${endDate.toISOString()}, false)
        `;
        console.log(`Twilio number purchased and stored: ${purchased.phoneNumber} (${purchased.sid})`);
      } catch (err: any) {
        console.error('Error processing checkout.session.completed:', err);
      }
      break;
    }
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log(`PaymentIntent ${paymentIntent.id} succeeded`);
      break;
    }
    default: {
      console.log(`Unhandled event type ${event.type}`);
    }
  }

  res.status(200).json({ received: true });
}
