// pages/api/twilio/voice.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ko-KR">
    지금 수신자는 해외 체류 중이라 전화를 받을 수 없습니다. 
    나중에 다시 연락해 주세요.
  </Say>
</Response>`;

  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.status(200).send(xml);
}
