import { GetServerSideProps } from 'next';
import { validateLeaveToken } from '../../lib/leaveToken';
import { useState } from 'react';

interface Props {
  valid: boolean;
  tokenParam: string;
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const token = context.params?.token as string;
  let valid = false;
  try {
    const result = await validateLeaveToken(token);
    if (result) {
      valid = true;
    }
  } catch (error) {
    valid = false;
  }
  return { props: { valid, tokenParam: token } };
};

export default function LeaveTokenPage({ valid, tokenParam }: Props) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'form' | 'success' | 'error'>('form');
  const [error, setError] = useState('');

  if (!valid) {
    return (
      <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
        <p>유효하지 않거나 만료된 링크입니다</p>
      </div>
    );
  }

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenParam, message }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setError(data.error || '오류가 발생했습니다.');
      }
    } catch (err) {
      setStatus('error');
      setError('네트워크 오류가 발생했습니다.');
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
