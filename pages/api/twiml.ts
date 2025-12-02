import type { NextApiRequest, NextApiResponse } from "next";
import { VoiceResponse } from "twilio";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const twiml = new VoiceResponse();

  twiml.say(
    { language: "ko-KR" },
    "지금 해외 체류 중이라 통화 연결이 어렵습니다. 문자로 안내드리겠습니다."
  );

  // 🔥 핵심: Twilio가 콜 종료 이벤트 생성할 시간을 줌
  twiml.pause({ length: 1 });

  // 🔥 Twilio가 확실하게 StatusCallback을 보내도록 강제 종료
  twiml.hangup();

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
}
