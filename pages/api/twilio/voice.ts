import type { NextApiRequest, NextApiResponse } from 'next';
import { twiml } from 'twilio';

// Twilio uses urlencoded by default; disable bodyParser to get raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const response = new twiml.VoiceResponse();
  const message = '지금 해외 체류 중이라 전화를 받을 수 없습니다. 잠시 후 다시 연락드리겠습니다.';
  response.say({ language: 'ko-KR' }, message);
  response.pause();
  response.say({ language: 'ko-KR' }, message);

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(response.toString());
}
