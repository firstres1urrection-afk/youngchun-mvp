import { useState } from 'react';

export default function LeaveDebugPage() {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'form' | 'success' | 'error'>('form');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!message.trim()) {
      setError('메시지를 입력해주세요.');
      setStatus('error');
      return;
    }
    try {
      const res = await fetch('/api/leave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });
      if (res.ok) {
        setStatus('success');
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || '오류가 발생했습니다.');
        setStatus('error');
      }
    } catch (err) {
      setError('네트워크 오류가 발생했습니다.');
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
        <p>메시지가 성공적으로 전달되었습니다</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
      <p>
        수신자는 해외 체류 중입니다.
        <br />
        아래에 메시지를 남기면 수신자에게 전달됩니다.
      </p>
      {status === 'error' && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <textarea
          name="message"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          style={{ width: '100%', marginBottom: '1rem' }}
        />
        <button type="submit">메시지 남기기</button>
      </form>
    </div>
  );
}
