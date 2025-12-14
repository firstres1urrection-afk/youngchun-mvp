import type { NextApiRequest, NextApiResponse } from 'next';
import Twilio from 'twilio';
import { createLeaveToken } from '../../../lib/leaveToken';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const smsFrom =
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

  const from: string | undefined = req.body.From;
  const to: string | undefined = req.body.To;
  const callSid: string | undefined = req.body.CallSid;

  let token: string | undefined;

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
    console.error('Error creating leave token', err);
  }

  // send SMS asynchronously to avoid delaying voice response
 (async () => {
    console.log('[voice] env smsFrom=', smsFrom);
console.log('[voice] from/to/callSid=', from, to, callSid);
    
    if (token && from && smsFrom) {
      const leaveUrl = `https://youngchun.io/leave/${token}`;
      const body =
        '지금 수신자는 해외 체류 중이라 전화를 받지 못했습니다.\n급한 용건은 아래 링크로 남겨주세요. 수신자에게 전달됩니다.\n\n' +
        leaveUrl;
      try {
        await client.messages.create({
          to: from,
          from: smsFrom,
          body,
        });
      } catch (err) {
        console.error('Failed to send leave link SMS', err);
      }
    }

    // optionally send alert to admin about incoming call
    if (alertTarget && smsFrom) {
      try {
        await client.messages.create({
          to: alertTarget,
          from: smsFrom,
          body: `Voice call received from ${from ?? ''} to ${
            to ?? ''
          }${token ? ' with token ' + token : ''}`,
        });
      } catch (err) {
        console.error('Failed to send alert SMS', err);
      }
    }
  })();

  const voiceResponse = new Twilio.twiml.VoiceResponse();
  // Provide a simple voice message; keep original voice behavior
  voiceResponse.say(
    { language: 'ko-KR' },
    '지금 수신자는 해외 체류 중이라 전화를 받지 못했습니다. 급한 용건은 문자로 남겨주세요.'
  );
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(voiceResponse.toString());
}
