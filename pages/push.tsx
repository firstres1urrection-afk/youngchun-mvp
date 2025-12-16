import { useEffect, useState } from 'react';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushPage() {
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(async (registration) => {
        const sub = await registration.pushManager.getSubscription();
        setSubscription(sub);
      });
    }
  }, []);

  const subscribe = async () => {
    if (!('serviceWorker' in navigator)) {
      setMessage('Service workers not supported');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setMessage('알림 권한이 거부되었습니다.');
      return;
    }
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string),
    });
    setSubscription(sub);
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sub),
    });
    setMessage('구독이 저장되었습니다.');
  };

  const sendTestPush = async () => {
    const res = await fetch('/api/push/test', {
      method: 'POST',
    });
    if (res.ok) {
      setMessage('테스트 푸시를 발송했습니다.');
    } else {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error || 'Error sending push');
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>푸시 알림</h1>
      <p>구독 상태: {subscription ? '구독됨' : '미구독'}</p>
      <button onClick={subscribe} disabled={!!subscription}>
        알림 허용하기
      </button>
      <button onClick={sendTestPush} style={{ marginLeft: '10px' }}>
        테스트 푸시 보내기
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
