import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200);
  res.setHeader('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ko-KR" loop="3">
    현재 수신자는 해외 체류 중이라 통화 연결이 어렵습니다.
    급한 용무는 문자로 남겨 주시면, 확인 후 연락드리겠습니다.
  </Say>
  <Hangup/>
</Response>`);
}

