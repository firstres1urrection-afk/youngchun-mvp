import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import qs from 'querystring';

// Twilio는 x-www-form-urlencoded 로 status callback을 보냄
export const config = {
  api: {
    bodyParser: false,
  },
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function readRawBody(req: NextApiRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const raw = await readRawBody(req);
    const body = qs.parse(raw) as Record<string, string | string[] | undefined>;

    const attemptId =
      typeof req.query.attemptId === 'string'
        ? Number(req.query.attemptId)
        : null;

    const messageSid =
      typeof body.MessageSid === 'string'
        ? body.MessageSid
        : typeof body.SmsSid === 'string'
        ? body.SmsSid
        : null;

    const messageStatus =
      typeof body.MessageStatus === 'string'
        ? body.MessageStatus
        : typeof body.SmsStatus === 'string'
        ? body.SmsStatus
        : null;

    const errorCode =
      typeof body.ErrorCode === 'string' ? body.ErrorCode : null;

    if (attemptId) {
      await pool.query(
        `
        update message_attempts
        set
          request_stage = 'callback_received',
          twilio_message_sid = coalesce(twilio_message_sid, $1),
          twilio_status = $2,
          twilio_error_code = coalesce($3, twilio_error_code)
        where id = $4
        `,
        [messageSid, messageStatus, errorCode, attemptId]
      );
    }

    return res.status(200).send('ok');
  } catch (e) {
    // Twilio는 실패해도 200을 주는 게 안전함 (재시도 폭탄 방지)
    console.error('[sms-status] callback handling failed', e);
    return res.status(200).send('ok');
  }
}
