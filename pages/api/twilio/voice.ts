import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';

type TwilioRequestBody = {
  From?: string;
  To?: string;
  CallStatus?: string;
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

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const alertTarget = process.env.ALERT_TARGET_PHONE;
  const smsFrom = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM;

  if (accountSid && authToken && smsFrom) {
    const client = twilio(accountSid, authToken);

    if (from) {
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

    if (alertTarget) {
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
// redeploy trigger
      } catch (err) {
        console.error('Failed to send SMS to alert target', err);
      }
    }
  }

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
