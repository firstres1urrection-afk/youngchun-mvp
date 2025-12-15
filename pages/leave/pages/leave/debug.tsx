import { useState } from 'react';

export default function LeaveDebugPage() {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'form' | 'success' | 'error'>('form');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('form');
    setErrorMessage('');
    try {
      const res = await fetch('/api/leave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          token: null,
        }),
      });
      if (res.ok) {
        setStatus('success');
      } else {
        const data = await res.json().catch(() => null);
        setStatus('error');
        setErrorMessage(
          (data && data.error) ||
            '메시지 전송 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.'
        );
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage('메시지 전송 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.');
    }
  };

  if (status === 'success') {
    return (
      <div style={{ padding: '1rem' }}>
        <p>메시지가 성공적으로 전달되었습니다.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem' }}>
      <p>
        수신자는 해외 체류 중입니다.
        <br />
        아래에 메시지를 남기면 수신자에게 전달됩니다.
      </p>
      {status === 'error' && (
        <p style={{ color: 'red' }}>
          {errorMessage || '메시지 전송 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.'}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <textarea
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
