import type { NextApiRequest, NextApiResponse } from 'next';
import Twilio from 'twilio';
import { createLeaveToken } from '../../../lib/leaveToken';

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
const alertTarget = process.env.ALERT_TARGET;

const client = Twilio(accountSid, authToken);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // Twilio webhook params
  const from = req.body.From as string | undefined;
  const to = req.body.To as string | undefined;
  const callSid = req.body.CallSid as string | undefined;

  console.log('[voice] from/to/callSid=', from, to, callSid);

  // 1) leave token 생성 (실패해도 계속 진행)
  let token: string | undefined;
  try {
    if (callSid && from && to) {
      const result = await createLeaveToken({
        callSid,
        fromNumber: from,
        toNumber: to,
      });
      token = result?.token;
    }
  } catch (err) {
    console.error('[voice] token creation failed', err);
  }

  // 2) SMS 발송 (Messaging Service SID 사용)
  (async () => {
    if (!from) {
      console.warn('[voice] missing from number');
      return;
    }

    if (!messagingServiceSid) {
      console.error('[voice] missing TWILIO_MESSAGING_SERVICE_SID');
      return;
    }

    const leaveUrl = token
      ? `https://youngchun.io/leave/${token}`
      : 'https://youngchun.io/leave/debug';

    const body =
      '지금 수신자는 해외 체류 중이라 전화를 받지 못했습니다.\n' +
      '급한 용건은 아래 링크로 남겨주세요. 수신자에게 전달됩니다.\n\n' +
      leaveUrl;

    try {
      await client.messages.create({
        to: from,
        messagingServiceSid,
        body,
      });
      console.log('[voice] SMS sent via Messaging Service');
    } catch (err) {
      console.error('[voice] SMS send failed', err);
    }

    // (선택) 운영자 알림
    if (alertTarget) {
      try {
        await client.messages.create({
          to: alertTarget,
          messagingServiceSid,
          body: `[voice] incoming call from ${from}`,
        });
      } catch (err) {
        console.error('[voice] alert SMS failed', err);
      }
    }
  })();

  // 3) 음성 응답
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say(
    { language: 'ko-KR' },
    '지금 수신자는 해외 체류 중이라 전화를 받지 못했습니다. 급한 용건은 문자로 남겨주세요.'
  );

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(twiml.toString());
}
