import type { NextApiRequest, NextApiResponse } from 'next';
import Twilio from 'twilio';
import { Pool } from 'pg';
import crypto from 'crypto';
import qs from 'querystring';

// Twilio는 기본적으로 x-www-form-urlencoded로 webhook을 보냄.
// Next.js 기본 bodyParser(JSON)는 깨질 수 있어서 raw로 받고 직접 파싱.
export const config = {
  api: {
    bodyParser: false,
  },
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

function getBaseUrl() {
  // NEXT_PUBLIC_BASE_URL 우선, 없으면 Vercel 자동 URL 사용
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  );
}

async function readRawBody(req: NextApiRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const raw = await readRawBody(req);
  const body = qs.parse(raw) as Record<string, string | string[] | undefined>;

  const from = typeof body.From === 'string' ? body.From : '';
  const to = typeof body.To === 'string' ? body.To : '';
  const callSid = typeof body.CallSid === 'string' ? body.CallSid : '';

  // Twilio client
  const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';

  if (!accountSid || !authToken) {
    console.error('[voice] missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');
  }
  if (!messagingServiceSid) {
    console.error('[voice] missing TWILIO_MESSAGING_SERVICE_SID');
  }

  const client = Twilio(accountSid, authToken);

  // 1) leave token 생성 + 저장 (기존 /leave 흐름 유지용)
  // ⚠️ 여기서 token을 저장해두면 /leave 페이지가 token을 받아 메시지를 저장할 수 있음.
  const leaveToken = crypto.randomBytes(16).toString('hex');

  // 이 테이블명이 프로젝트와 다를 수 있음.
  // 너희가 이미 "leave token 저장"을 하고 있으니, 실제 테이블/컬럼에 맞춰 1회만 조정하면 됨.
  // (일단은 "leave_messages(token, created_at)" 형태를 가정)
  try {
    await pool.query(
      `
      insert into leave_messages (token, created_at, from_phone, to_phone, call_sid)
      values ($1, now(), $2, $3, $4)
      `,
      [leaveToken, from, to, callSid]
    );
  } catch (e) {
    // 여기서 실패해도 voice 자체는 살아야 하므로 throw하지 않음
    console.error('[voice] leave token insert failed (check leave_messages schema)', e);
  }

  // 2) 발신자에게 SMS로 leave 링크 발송 + 계측(message_attempts)
  const baseUrl = getBaseUrl();
  const leaveUrl =
    baseUrl && baseUrl.length > 0
      ? `${baseUrl}/leave?token=${leaveToken}`
      : `https://YOUR_DOMAIN/leave?token=${leaveToken}`;

  const smsText = `부재중 메시지 남기기: ${leaveUrl}`;

  let attemptId: number | null = null;

  // 2-1) attempt insert
  try {
    const insert = await pool.query(
      `
      insert into message_attempts
        (call_sid, leave_token, from_phone, to_phone, messaging_service_sid, request_stage, request_payload)
      values
        ($1, $2, $3, $4, $5, 'create_called', $6)
      returning id
      `,
      [
        callSid || null,
        leaveToken || null,
        to || null, // 원래 국내번호(수신자) 쪽
        from, // SMS 받는 사람 = 발신자
        messagingServiceSid || null,
        JSON.stringify({ to: from, bodyPreview: smsText.slice(0, 80) }),
      ]
    );
    attemptId = insert.rows?.[0]?.id ?? null;
  } catch (e) {
    console.error('[voice] message_attempts insert failed', e);
  }

  // 2-2) Twilio SMS 발송
  try {
    if (messagingServiceSid) {
      const msg = await client.messages.create({
        to: from,
        messagingServiceSid,
        body: smsText,
        statusCallback:
          baseUrl && attemptId
            ? `${baseUrl}/api/twilio/sms-status?attemptId=${attemptId}`
            : undefined,
      });

      // attempt update (sid/status)
      if (attemptId) {
        await pool.query(
          `
          update message_attempts
          set twilio_message_sid = $1,
              twilio_status = $2,
              response_payload = $3,
              notes = coalesce(notes,'') || $4
          where id = $5
          `,
          [
            msg.sid ?? null,
            msg.status ?? 'queued',
            JSON.stringify({ sid: msg.sid, status: msg.status }),
            '\ncreate_ok',
            attemptId,
          ]
        );
      }

      console.log('[voice] SMS created', msg.sid, msg.status);
    } else {
      console.error('[voice] messagingServiceSid missing -> skip SMS send');
      if (attemptId) {
        await pool.query(
          `
          update message_attempts
          set request_stage = 'create_failed',
              twilio_error_message = $1,
              notes = coalesce(notes,'') || $2
          where id = $3
          `,
          ['missing TWILIO_MESSAGING_SERVICE_SID', '\ncreate_failed', attemptId]
        );
      }
    }
  } catch (err: any) {
    console.error('[voice] SMS send failed', err);

    if (attemptId) {
      try {
        await pool.query(
          `
          update message_attempts
          set request_stage = 'create_failed',
              twilio_error_code = $1,
              twilio_error_message = $2,
              response_payload = $3,
              notes = coalesce(notes,'') || $4
          where id = $5
          `,
          [
            err?.code ? String(err.code) : null,
            err?.message ? String(err.message) : String(err),
            JSON.stringify({ raw: String(err) }),
            '\ncreate_failed',
            attemptId,
          ]
        );
      } catch (e) {
        console.error('[voice] message_attempts update failed', e);
      }
    }
  }

  // 3) TwiML 응답 (발신자에게 음성 안내)
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say(
    { language: 'ko-KR' },
    '지금 수신자는 해외 체류 중이라 전화를 받지 못했습니다. 잠시 후 문자로 메시지 남기기 링크를 보내드립니다.'
  );

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(twiml.toString());
}
