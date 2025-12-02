import type { NextApiRequest, NextApiResponse } from 'next';
const twilio = require('twilio');

interface UserSettings {
  startDate: string;
  endDate: string;
  contact: string;
}

const globalStore: any = global as any;
const userSettingsStore: Record<string, UserSettings> = globalStore.userSettingsStore || {};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const { From, To, CallStatus } = req.body as any;
  console.log('Twilio Status Callback:', { From, To, CallStatus });

  // Only process completed call status
  if (CallStatus !== 'completed') {
    res.status(200).json({ message: 'Event ignored' });
    return;
  }

  // Determine user by the Twilio number used for the call
  const twilioNumber: string = To || process.env.TWILIO_PHONE_NUMBER || '';

  // Try to get user settings from in-memory store
  let userSetting = userSettingsStore[twilioNumber];

  // Fallback: read settings from environment variables if available
  if (!userSetting && process.env.SERVICE_START_DATE && process.env.SERVICE_END_DATE && process.env.CONTACT_PHONE_NUMBER) {
    userSetting = {
      startDate: process.env.SERVICE_START_DATE,
      endDate: process.env.SERVICE_END_DATE,
      contact: process.env.CONTACT_PHONE_NUMBER,
    } as UserSettings;
  }

  if (!userSetting) {
    console.log('No user settings found for number', twilioNumber);
    res.status(200).json({ message: 'No user settings found' });
    return;
  }

  const { startDate, endDate, contact } = userSetting;
  const nowTime = Date.now();
  const endTime = new Date(endDate).getTime();

  // If the end date has passed, do not send SMS
  if (endTime <= nowTime) {
    console.log('Service expired for number', twilioNumber);
    res.status(200).json({ message: 'Service expired' });
    return;
  }

  // Format the call time in Korean Standard Time
  const seoulTime = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    // Send SMS asynchronously
    client.messages
      .create({
        from: process.env.TWILIO_PHONE_NUMBER || twilioNumber,
        to: contact,
        body: `부재중 전화: ${From} / 시간: ${seoulTime}`,
      })
      .then((message: any) => {
        console.log('SMS sent:', message.sid);
      })
      .catch((err: any) => {
        console.error('Error sending SMS:', err);
      });
  } catch (error) {
    console.error('Twilio client error:', error);
  }

  res.status(200).json({ message: 'Callback processed' });
}
