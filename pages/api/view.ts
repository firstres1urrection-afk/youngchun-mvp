import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@vercel/postgres';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { messageId } = req.query;
  const id = parseInt(
    Array.isArray(messageId) ? messageId[0] : (messageId as string),
    10
  );

  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid messageId' });
  }

  try {
    await sql`\
      CREATE TABLE IF NOT EXISTS leave_messages (
        id SERIAL PRIMARY KEY,
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    const result = await sql`SELECT message FROM leave_messages WHERE id = ${id}`;
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    return res.status(200).json({ message: result.rows[0].message });
  } catch (error: any) {
    console.error('Error retrieving message:', error);
    return res.status(500).json({ error: 'Failed to retrieve message' });
  }
}
