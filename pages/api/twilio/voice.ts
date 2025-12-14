import type { NextApiRequest, NextApiResponse } from 'next';
import Twilio from 'twilio';
import { createLeaveToken } from '../../../lib/leaveToken';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// SMS 발신 번호 (env 우선, 없으면 수신 번호(To)로 fallback)
const smsFromEnv =
  process.env.TWILIO_SMS_FROM_NUMBER ||
  process.env.TWILIO_PHONE_NUMBER ||
  process.env.TWILIO_FROM;

const alertTarget = process.env.ALERT_TARGET;

const client = Twilio(accountSid ?? '', authToken ?? '');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // Twilio webhook params
  const from: string | undefined = req.body.From; // 발신자
  const to: string | undefined = req.body.To;     // 수신자(Twilio 번호)
  const callSid: string | undefined = req.body.CallSid;

  // 👉 핵심: From이 비어버리는 걸 막기 위한 fallback
  const smsFromResolved = smsFromEnv || to;

  console.log('[voice] env smsFrom=', smsFromEnv);
  console.log('[voice] resolved smsFrom=', smsFromResolved);
  console.log('[voice] from/to/callSid=', from, to, callSid);

  let token: string | undefined;

  // 1) leave token 생성
  try {
    if (callSid && from && to) {
      const { token: createdToken } = await createLeaveToken({
        callSid,
        fromNumber: from,
        toNumber: to,
      });
      token = createdToken;
    }
  } catch (err) {
    console.error('[voice] Error creating leave token', err);
  }

  // 2) SMS 발송 (비동기)
  (async () => {
    if (!token || !from || !smsFromResolved) {
      console.warn('[voice] Skip SMS send', {
        token,
        from,
        smsFromResolved,
      });
      return;
    }

    const leaveUrl = `https://youngchun.io/leave/${token}`;
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
      console.log('[voice] Leave link SMS sent');
    } catch (err) {
      console.error('[voice] Failed to send leave link SMS', err);
    }

    // (선택) 운영자 알림
    if (alertTarget) {
      try {
        await client.messages.create({
          to: alertTarget,
          from: smsFromResolved,
          body: `Voice call received\nfrom: ${from}\nto: ${to}\ntoken: ${token}`,
        });
      } catch (err) {
        console.error('[voice] Failed to send alert SMS', err);
      }
    }
  })();

  // 3) 음성 응답 (TwiML)
  const voiceResponse = new Twilio.twiml.VoiceResponse();
  voiceResponse.say(
    { language: 'ko-KR' },
    '지금 수신자는 해외 체류 중이라 전화를 받지 못했습니다. 급한 용건은 문자로 남겨주세요.'
  );

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(voiceResponse.toString());
}
