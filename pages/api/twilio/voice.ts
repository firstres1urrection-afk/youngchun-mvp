import type { NextApiRequest, NextApiResponse } from 'next';
import Twilio from 'twilio';
import { createLeaveToken } from '../../../lib/leaveToken';

const accountSid = process.env.TWILIO_ACCOUNT_SID ?? '';
const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';

// SMS 발신 번호 (env 우선, 없으면 수신 번호(To)로 fallback)
const smsFromEnv =
  process.env.TWILIO_SMS_FROM_NUMBER ||
  process.env.TWILIO_PHONE_NUMBER ||
  process.env.TWILIO_FROM;

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
  const from = req.body.From as string | undefined; // 발신자
  const to = req.body.To as string | undefined;     // 수신자(Twilio 번호)
  const callSid = req.body.CallSid as string | undefined;

  const smsFromResolved = smsFromEnv || to;

  console.log('[voice] env smsFrom=', smsFromEnv);
  console.log('[voice] resolved smsFrom=', smsFromResolved);
  console.log('[voice] from/to/callSid=', from, to, callSid);

  // 1) leave token 생성 (실패해도 진행)
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

  // 2) SMS 발송 (토큰 없어도 무조건 발송)
  (async () => {
    if (!from || !smsFromResolved) {
      console.warn('[voice] missing from or smsFromResolved');
      return;
    }

    const leaveUrl = token
      ? `https://youngchun.io/leave/${token}`
      : 'https://youngchun.io/leave/debug'; // 디버그 링크

    const body =
      '지금 수신자는 해외 체류 중이라 전화를 받지 못했습니다.\n' +
      '급한 용건은 아래 링크로 남겨주세요. 수신자에게 전달됩니다.\n\n' +
      leaveUrl;

    try {
      await client.messages.create({
        to: from,
        from: smsFromResolved,
        body,
      });
      console.log('[voice] SMS sent to caller');
    } catch (err) {
      console.error('[voice] SMS send failed', err);
    }

    // (선택) 운영자 알림
    if (alertTarget) {
      try {
        await client.messages.create({
          to: alertTarget,
          from: smsFromResolved,
          body: `[voice] incoming call from ${from}`,
        });
      } catch (err) {
        console.error('[voice] alert SMS failed', err);
      }
    }
  })();

  // 3) 음성 응답 (항상 정상 반환)
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say(
    { language: 'ko-KR' },
    '지금 수신자는 해외 체류 중이라 전화를 받지 못했습니다. 급한 용건은 문자로 남겨주세요.'
  );

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(twiml.toString());
}
