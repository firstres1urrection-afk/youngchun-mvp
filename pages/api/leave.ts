import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@vercel/postgres';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { message } = req.body;

  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ success: false, error: 'Invalid message' });
  }

  try {
    // Create table if it doesn't exist
    await sql`\
      CREATE TABLE IF NOT EXISTS leave_messages (
        id SERIAL PRIMARY KEY,
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`\
      INSERT INTO leave_messages (message)
      VALUES (${message})
    `;

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error saving message:', error);
    return res.status(500).json({ success: false, error: 'Failed to save message' });
  }
}
