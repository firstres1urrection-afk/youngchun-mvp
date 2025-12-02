import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ko-KR">지금 해외 체류 중이라 통화 연결이 어렵습니다. 문자로 안내드리겠습니다.</Say>
</Response>`;
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(responseXml);
}
