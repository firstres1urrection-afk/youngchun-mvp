import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@vercel/postgres';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const { user_id, customer_id } = req.body || {};
  try {
    await sql`CREATE TABLE IF NOT EXISTS prepare_status (
      id SERIAL PRIMARY KEY,
      user_id varchar(255),
      customer_id varchar(255),
      prepare_completed boolean,
      completed_at timestamp
    );`;
    await sql`INSERT INTO prepare_status (user_id, customer_id, prepare_completed, completed_at) VALUES (${user_id}, ${customer_id}, true, NOW());`;
    return res.status(200).json({ message: 'Prepare status recorded' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
