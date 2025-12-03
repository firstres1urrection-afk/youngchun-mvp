import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { buffer } from 'micro';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2025-11-17.clover',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

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
    console.error(`Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('✅ checkout.session.completed:', {
        id: session.id,
        amount_total: session.amount_total,
        currency: session.currency,
        customer: session.customer,
      });

      // 금액 → 이용기간 매핑 테이블
      const priceToDays: Record<number, number> = {
        4900: 3,
        7900: 7,
        11900: 14,
        18900: 30,
      };

      // Stripe 결제 금액에서 기간 계산
      const durationDays = priceToDays[session.amount_total!];

      // 시작/종료 날짜 계산
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(startDate.getDate() + durationDays);

      // 로깅
      console.log("\uD83D\uDCBE Service period calculated:", {
        sessionId: session.id,
        amount: session.amount_total,
        durationDays,
        startDate,
        endDate,
      });

      break;
    }
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log('✅ payment_intent.succeeded:', {
        id: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        customer: paymentIntent.customer,
      });
      break;
    }
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}
