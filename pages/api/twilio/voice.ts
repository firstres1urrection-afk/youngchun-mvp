import type { NextApiRequest, NextApiResponse } from 'next';
import { Twilio, twiml } from 'twilio';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end('Method Not Allowed');
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const alertTargetPhone = process.env.ALERT_TARGET_PHONE;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM;
  const client = new Twilio(accountSid ?? '', authToken ?? '');

  const from = (req.body?.From as string) || '';
  const to = (req.body?.To as string) || '';

  try {
    if (alertTargetPhone) {
      await client.messages.create({
        from: fromNumber ?? undefined,
        to: alertTargetPhone,
        body: `부재중 전화 알림:\n발신: ${from}\n번호: ${to}\n\n현재 해외 체류 중이라 전화를 받기 어려운 상태입니다.\n급한 용무는 문자로 남겨 주세요.`,
      });
    }
  } catch (error) {
    console.error('Failed to send SMS alert', error);
  }

  const voiceResponse = new twiml.VoiceResponse();
  voiceResponse.say(
    {
      language: 'ko-KR',
      voice: 'alice',
    },
    '현재 수신자는 해외 체류 중이라 통화 연결이 어렵습니다. 급한 용무는 문자로 남겨 주시면 확인 후 연락드리겠습니다.',
  );

  res.status(200).setHeader('Content-Type', 'text/xml');
  res.send(voiceResponse.toString());
}
