import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';
import { sql } from '@vercel/postgres';

type TwilioRequestBody = {
  From?: string;
  To?: string;
  CallStatus?: string;
  Called?: string;
  [key: string]: any;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const body = (req.body || {}) as TwilioRequestBody;
  const from = body.From || '';
  const to = body.To || '';
  const called = body.Called || '';

  // Determine the Twilio number that was called
  const twilioNumber = to || called || '';

  // Query expire_at from call_forward_numbers table
  let expireAt: Date | null = null;
  try {
    if (twilioNumber) {
      const result = await sql`SELECT expire_at FROM call_forward_numbers WHERE twilio_number = ${twilioNumber} OR twilio_sid = ${twilioNumber} LIMIT 1`;
      if (result.rows.length > 0 && result.rows[0].expire_at) {
        expireAt = result.rows[0].expire_at as unknown as Date;
      }
    }
  } catch (err) {
    console.error('Failed to fetch expire_at for number', twilioNumber, err);
  }

  const nowTime = Date.now();
  const expireTime = expireAt ? new Date(expireAt).getTime() : null;

  // If no record or expireAt has passed, treat as expired
  if (!expireTime || expireTime <= nowTime) {
    const twimlExpired = `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="ko-KR">서비스 기간이 만료되었습니다</Say><Hangup/></Response>`;
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(200).send(twimlExpired);
  }

  // Twilio credentials and numbers
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const smsFrom = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM;
  // Use fixed alert target number as per requirements
  const alertTarget = '+821027388709';

  if (accountSid && authToken && smsFrom) {
    const client = twilio(accountSid, authToken);

    // Send SMS to caller
    if (from) {
      console.log('[SMS_ATTEMPT][CALLER]');
      try {
        await client.messages.create({
          to: from,
          from: smsFrom,
          body: [
            '[부재중 안내]',
            '현재 수신자는 해외 체류 중이라 전화를 받기 어렵습니다.',
            '급한 용무는 이 번호로 문자만 보내 주세요.',
          ].join('\n'),
        });
      } catch (err) {
        console.error('Failed to send SMS to caller', err);
      }
    }

    // Send SMS to fixed alert target
    if (alertTarget) {
      console.log('[SMS_ATTEMPT][CALLEE]');
      try {
        const now = new Date();
        const timeStr = now.toISOString();
        await client.messages.create({
          to: alertTarget,
          from: smsFrom,
          body: [
            '[부재중 전화 알림]',
            `발신: ${from || '알 수 없음'}`,
            `수신 번호: ${to || '알 수 없음'}`,
            `시간: ${timeStr}`,
            '',
            '상대방이 위 번호로 전화를 시도했습니다.',
          ].join('\n'),
        });
      } catch (err) {
        console.error('Failed to send SMS to alert target', err);
      }
    }
  }

  // Build TwiML for voice response
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ko-KR" loop="3">
    현재 수신자는 해외 체류 중이라 통화 연결이 어렵습니다.
    급한 용무는 문자로 남겨 주시면, 확인 후 연락드리겠습니다.
  </Say>
  <Hangup/>
</Response>`;

  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  return res.status(200).send(twiml);
}
