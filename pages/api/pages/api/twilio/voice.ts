import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const vr = new twilio.twiml.VoiceResponse();

  vr.say(
    { language: 'ko-KR' },
    '지금 수신자는 해외 체류 중이라 전화를 받을 수 없습니다. 나중에 다시 연락해 주세요.'
  );

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(vr.toString());
}
