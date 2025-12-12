import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const body = req.body as { [key: string]: any };
  const from = body.From;
  const to = body.To;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const adminNumber = process.env.ALERT_TARGET_PHONE || process.env.TWILIO_ADMIN_PHONE;

  const client = twilio(accountSid as string, authToken as string);

  const announcement =
    '현재 수신자는 해외 체류 중이라 통화 연결이 어렵습니다. 급한 용무는 문자로 남겨 주시면, 확인 후 연락드리겠습니다.';

  // Send SMS to caller immediately
  try {
    if (from) {
      await client.messages.create({
        from: fromNumber as string,
        to: from,
        body: announcement,
      });
    }
  } catch (error) {
    console.error('Error sending SMS to caller', error);
  }

  // Send SMS to admin immediately
  try {
    if (adminNumber) {
      const time = new Date().toISOString();
      const msg = `${from ?? 'Unknown'} 번호가 ${time}에 5379로 전화했습니다.`;
      await client.messages.create({
        from: fromNumber as string,
        to: adminNumber,
        body: msg,
      });
    }
  } catch (error) {
    console.error('Error sending SMS to admin', error);
  }

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.say({ language: 'ko-KR', loop: 3 }, announcement);
  response.hangup();

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(response.toString());
}
