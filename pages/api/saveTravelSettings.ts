import type { NextApiRequest, NextApiResponse } from 'next';

type TravelSettings = {
  userId?: string;
  startDate: string;
  endDate: string;
  notify: boolean;
  messageType: string;
  contact: string;
};

let settingsStore: TravelSettings[] = [];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { startDate, endDate, notify, messageType, contact } = req.body;
    const setting: TravelSettings = {
      startDate,
      endDate,
      notify: notify ?? false,
      messageType: messageType ?? 'reminder',
      contact,
    };
    settingsStore.push(setting);
    res.status(200).json({ message: 'Settings saved', setting });
  } else {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ message: 'Method Not Allowed' });
  }
}
