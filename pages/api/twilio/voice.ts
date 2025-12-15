// Twilio webhook params
const from = req.body.From as string | undefined; // 발신자
const to = req.body.To as string | undefined; // 수신자(Twilio 번호)
const callSid = req.body.CallSid as string | undefined;

const baseUrl =
  process.env.NEXT_PUBLIC_BASE_URL || 'https://youngchun-mvp.vercel.app';

const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

console.log('[voice] from/to/callSid=', from, to, callSid);
console.log('[voice] messagingServiceSid exists=', Boolean(messagingServiceSid));

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
  if (!from) {
    console.warn('[voice] missing from');
    return;
  }
  if (!messagingServiceSid) {
    console.error('[voice] Missing TWILIO_MESSAGING_SERVICE_SID');
    return;
  }

  const leaveUrl = token ? `${baseUrl}/leave/${token}` : `${baseUrl}/leave/debug`;

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
    console.log('[voice] SMS sent to caller (via Messaging Service)');
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
