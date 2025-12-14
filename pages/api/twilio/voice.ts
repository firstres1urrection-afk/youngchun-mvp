import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';
import { createLeaveToken } from '../../../lib/leaveToken';

const accountSid = process.env.TWILIO_ACCOUNT_SID as string;
const authToken = process.env.TWILIO_AUTH_TOKEN as string;
const client = twilio(accountSid, authToken);

const smsFrom = process.env.TWILIO_SMS_FROM_NUMBER || process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end('Method Not Allowed');
  }

  const from: string | undefined = req.body.From;
  const to: string | undefined = req.body.To;
  const callSid: string | undefined = req.body.CallSid;

  // environment variable for alert target (for admin)
  const alertTarget = process.env.ALERT_TARGET;

  // Send SMS to caller with leave link
  if (from && callSid) {
    try {
      const token = await createLeaveToken({ callSid, fromNumber: from, toNumber: to });
      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.PUBLIC_BASE_URL ||
        'https://youngchun.io';
      const cleanBase = baseUrl.replace(/\/$/, '');
      const leaveUrl = `${cleanBase}/leave/${token}`;
      const body =
        '지금 수신자는 해외 체류 중이라 전화를 받지 못했습니다.\n' +
        '급한 용건은 아래 링크로 남겨주세요. 수신자에게 전달됩니다.\n\n' +
        leaveUrl;

      if (smsFrom) {
        try {
          await client.messages.create({
            to: from,
            from: smsFrom,
            body,
          });
          console.log(`Sent leave link SMS to caller: ${from} with token ${token}`);
        } catch (err) {
          console.error('Failed to send leave link SMS to caller', err);
        }
      } else {
        console.error('No TWILIO_SMS_FROM_NUMBER configured');
      }
    } catch (err) {
      console.error('Failed to create leave token or send SMS to caller', err);
    }
  }

  // existing alert to admin (if configured)
  if (alertTarget && smsFrom) {
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

  // Build TwiML for voice response (same as before)
  const twiml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Response>\n' +
    '  <Say language="ko-KR" loop="3">\n' +
    '    현재 수신자는 해외 체류 중이라 통화 연결이 어렵습니다.\n' +
    '    급한 용무는 문자로 남겨 주시면, 확인 후 연락드리겠습니다.\n' +
    '  </Say>\n' +
    '  <Hangup/>\n' +
    '</Response>';

  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  return res.status(200).send(twiml);
}
