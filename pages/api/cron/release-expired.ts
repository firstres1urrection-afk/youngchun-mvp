import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@vercel/postgres';
import twilio from 'twilio';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error('[release-expired] Twilio credentials not configured');
    return res.status(500).json({ message: 'Twilio credentials not configured' });
  }

  const client = twilio(accountSid, authToken);

  try {
    console.log('[release-expired] Cron invoked');

    // 🔍 0. 최근 10개 그냥 다 찍기 (어떤 DB를 보고 있는지 확인용)
    const debug = await sql`
      SELECT id, twilio_number, expire_at, is_released
      FROM call_forward_numbers
      ORDER BY id DESC
      LIMIT 10;
    `;
    console.log('[release-expired] recent call_forward_numbers rows:', debug.rows);

    // 🔍 1. 실제 만료 조건 쿼리
    const { rows } = await sql`
      SELECT *
      FROM call_forward_numbers
      WHERE expire_at < NOW() AND is_released = false;
    `;
    console.log('[release-expired] expired+unreleased rows:', rows);

    let releasedCount = 0;

    for (const row of rows) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const number = (row as any).twilio_number as string | null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let phoneSid: string | null =
          (row as any).twilio_sid || (row as any).phone_sid || null;

        // Twilio SID 없으면 번호로 역조회
        if (!phoneSid && number) {
          const phones = await client.incomingPhoneNumbers.list({
            phoneNumber: number,
            limit: 1,
          });
          if (phones && phones.length > 0) {
            phoneSid = phones[0].sid;
          }
        }

        if (!phoneSid) {
          console.warn(
            '[release-expired] Phone SID not found for row',
            row.id,
            'number',
            number
          );
          continue;
        }

        // Twilio 번호 해지 (과금 끊기)
        await client.incomingPhoneNumbers(phoneSid).remove();
        console.log(
          '[release-expired] Released Twilio number',
          phoneSid,
          '(',
          number,
          ')'
        );

        // DB에 is_released = true 반영
        await sql`
          UPDATE call_forward_numbers
          SET is_released = true
          WHERE id = ${row.id};
        `;
        releasedCount++;
      } catch (err) {
        // 개별 row 처리 중 에러
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        console.error(
          '[release-expired] Error releasing row id',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (row as any).id,
          'number',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (row as any).twilio_number,
          err
        );
      }
    }

    console.log('[release-expired] Finished. releasedCount =', releasedCount);
    return res.status(200).json({ releasedCount });
  } catch (error) {
    console.error('[release-expired] Fatal error in cron handler', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
