import type { NextApiRequest, NextApiResponse } from 'next';
import { Twilio, twiml } from 'twilio';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end('Method Not Allowed');
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
  const alertTargetPhone = process.env.ALERT_TARGET_PHONE;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM;
  const client = new Twilio(accountSid, authToken);

  const from = (req.body?.From as string) || '';
  const to = (req.body?.To as string) || '';
  const callTime = new Date().toISOString();

  // Send SMS to caller
  if (fromNumber && from) {
    try {
      await client.messages.create({
        from: fromNumber,
        to: from,
        body: `[부재중 안내]\n지금 수신자는 해외 체류 중이라 전화를 받기 어렵습니다.\n급한 용무는 이 번호로 문자만 보내 주세요.`,
      });
    } catch (err) {
      console.error('Failed to send SMS to caller', err);
    }
  }

  // Send SMS to alert target
  if (fromNumber && alertTargetPhone) {
    try {
      await client.messages.create({
        from: fromNumber,
        to: alertTargetPhone,
        body: `[부재중 전화 알림]\n발신: ${from}\n수신 번호(미국 가상번호): ${to}\n시간: ${callTime}\n\n상대방이 위 번호로 전화를 시도했습니다.`,
      });
    } catch (err) {
      console.error('Failed to send alert SMS', err);
    }
  }

  const voiceResponse = new twiml.VoiceResponse();
  voiceResponse.say(
    {
      language: 'ko-KR',
      voice: 'alice',
      loop: 3,
    },
    '현재 수신자는 해외 체류 중이라 통화 연결이 어렵습니다. 급한 용무는 문자로 남겨 주시면 확인 후 연락드리겠습니다.',
  );

  res.status(200).setHeader('Content-Type', 'text/xml');
  res.send(voiceResponse.toString());
}
