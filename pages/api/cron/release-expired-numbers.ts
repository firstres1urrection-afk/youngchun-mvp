// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@vercel/postgres';
const twilio = require('twilio');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // GET / POST만 허용
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end('Method Not Allowed');
  }

  // Twilio 자격증명
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return res
      .status(500)
      .json({ ok: false, error: 'Twilio credentials missing' });
  }

  const client = twilio(accountSid, authToken);

  try {
    // 만료된 번호 + 아직 해지 안 된 것들만 조회
    const { rows } = await sql`
      SELECT id, twilio_sid, twilio_number
      FROM call_forward_numbers
      WHERE expire_at < NOW()
        AND is_released = false
    `;

    let released = 0;

    for (const row of rows) {
      // 1) Twilio 쪽 번호 해지 시도 (실패해도 DB 정리는 계속 진행)
      try {
        await client.incomingPhoneNumbers(row.twilio_sid).remove();
        console.log(
          `Released Twilio number on Twilio side: ${row.twilio_number} (${row.twilio_sid})`
        );
      } catch (err) {
        console.error(
          `Error releasing number on Twilio side ${row.twilio_number} (${row.twilio_sid}):`,
          err
        );
        // 여기서 return 또는 throw 하지 않음 → DB 업데이트는 계속 간다
      }

      // 2) DB 상에서는 어쨌든 만료 처리 (비용 차단 관점에서 이게 핵심)
      try {
        await sql`
          UPDATE call_forward_numbers
          SET is_released = true
          WHERE id = ${row.id}
        `;
        released += 1;
      } catch (err) {
        console.error(
          `Error updating DB for number ${row.twilio_number} (${row.twilio_sid}):`,
          err
        );
      }
    }

    // 몇 개 체크했고, 그 중 몇 개를 "해지 처리"했는지 응답
    return res.status(200).json({
      ok: true,
      checked: rows.length,
      released,
    });
  } catch (err: any) {
    console.error('Error releasing expired numbers:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// test deploy
// test after connect
