// pages/api/stripe-webhook.ts

import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { buffer } from 'micro';
import { sql } from '@vercel/postgres';
import twilio from 'twilio';

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
 * KRW 기준 금액(단위: 원 / 100) -> 일수 매핑
 * 4,900 / 7,900 / 11,900 / 18,900 => 3 / 7 / 14 / 30일
 * amountUnits = amount_total / 100 이므로
 * 49 / 79 / 119 / 189 으로 들어온다.
 */
function priceToDays(amountUnits: number): number | null {
  switch (amountUnits) {
    case 49:
      return 3;
    case 79:
      return 7;
    case 119:
      return 14;
    case 189:
      return 30;
    default:
      return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  let buf: Buffer;
  try {
    buf = await buffer(req);
  } catch (err) {
    console.error('Error reading raw body:', err);
    return res.status(400).send('Webhook Error: Unable to read body');
  }

  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;

      try {
        // 1) 가격 → 기간 계산
        const amountTotalCents = session.amount_total ?? 0;
        const amountUnits = amountTotalCents / 100;
        const days = priceToDays(amountUnits);

        if (!days) {
          console.error(
            `priceToDays: unknown amountUnits=${amountUnits}, skipping Twilio purchase.`
          );
          break;
        }

        const startDate = new Date();
        const endDate = new Date(
          startDate.getTime() + days * 24 * 60 * 60 * 1000
        );

        // 2) 테이블 없으면 생성
        await sql`
          CREATE TABLE IF NOT EXISTS call_forward_numbers (
            id SERIAL PRIMARY KEY,
            user_id TEXT,
            twilio_number TEXT,
            twilio_sid TEXT,
            start_at TIMESTAMPTZ,
            expire_at TIMESTAMPTZ,
            is_released BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;

        // 3) Twilio 클라이언트 설정
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
          throw new Error('Twilio credentials missing');
        }

        const client = twilio(accountSid, authToken);

        // 4) 주소 제출 필요 없는 미국 로컬 번호 검색
        const available = await client.availablePhoneNumbers('US').local.list({
          voiceEnabled: true,
          limit: 20,
        });

        if (!available || available.length === 0) {
          throw new Error('Twilio search returned no numbers');
        }

        const purchasable = available.filter(
          (n: any) => n.addressRequirements === 'none'
        );

        if (purchasable.length === 0) {
          throw new Error(
            'No purchasable phone numbers (address requirement issue)'
          );
        }

        const candidate = purchasable[0];

        // 5) ✅ VoiceUrl / SmsUrl 한 줄짜리 유효 URL (21402 방지)
        const voiceUrl =
          'https://youngchun-mvp.vercel.app/api/twilio-callback';
        const smsUrl =
          'https://youngchun-mvp.vercel.app/api/twilio-callback';

        // 6) 번호 구매 + 콜백 URL 설정
        const purchased = await client.incomingPhoneNumbers.create({
          phoneNumber: candidate.phoneNumber,
          voiceUrl,
          smsUrl,
        });

        const userId = (session.customer as string) ?? session.id;

        // 7) DB 저장
        await sql`
          INSERT INTO call_forward_numbers 
            (user_id, twilio_number, twilio_sid, start_at, expire_at, is_released)
          VALUES 
            (${userId}, ${purchased.phoneNumber}, ${purchased.sid}, ${startDate.toISOString()}, ${endDate.toISOString()}, false)
        `;

        console.log(
          `✅ Twilio number purchased: ${purchased.phoneNumber} (${purchased.sid}), days=${days}`
        );
      } catch (err: any) {
        console.error('❌ Error in checkout.session.completed:', err);
      }

    case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        const stripeCustomerId = subscription.customer as string;
        const stripeSubscriptionId = subscription.id;
        await sql`
          CREATE TABLE IF NOT EXISTS subscriptions (
            id SERIAL PRIMARY KEY,
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT UNIQUE,
            status TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`
          INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, status)
          VALUES (${stripeCustomerId}, ${stripeSubscriptionId}, 'active')
          ON CONFLICT (stripe_subscription_id)
          DO UPDATE SET status = 'active', updated_at = NOW()
        `;
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const stripeSubscriptionId = subscription.id;
        await sql`
          UPDATE subscriptions
          SET status = 'canceled', updated_at = NOW()
          WHERE stripe_subscription_id = ${stripeSubscriptionId}
        `;
        break;
      }
   break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  return res.status(200).json({ received: true });
}
