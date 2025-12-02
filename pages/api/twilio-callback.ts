import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }
  const { From, To, CallStatus } = req.body as any;
  console.log('Twilio Status Callback:', { From, To, CallStatus });
  res.status(200).json({ message: 'Status received' });
}
