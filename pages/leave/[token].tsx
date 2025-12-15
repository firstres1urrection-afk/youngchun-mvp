import { GetServerSideProps } from 'next';
import { validateLeaveToken } from '../../lib/leaveToken';
import { useState } from 'react';

interface Props {
  tokenParam: string;
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const token = context.params?.token;

  // token 자체가 비정상이면 즉시 404
  if (typeof token !== 'string' || token.length < 8) {
    return { notFound: true };
  }

  try {
    const result: any = await validateLeaveToken(token);

    // validateLeaveToken이 boolean 또는 object를 반환해도 안전하게 판정
    const isValid =
      result === true ||
      result?.valid === true ||
      result?.isValid === true ||
      result?.ok === true;

    if (!isValid) {
      return { notFound: true };
    }

    return { props: { tokenParam: token } };
  } catch {
    return { notFound: true };
  }
};

export default function LeaveTokenPage({ tokenParam }: Props) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'form' | 'success' | 'error'>('form');
  const [error, setError] = useState('');

  async function submitMessage(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!message.trim()) {
      setError('메시지를 입력해주세요.');
      return;
    }

    try {
      const res = await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, token: tokenParam }),
      });

      if (!res.ok) {
        throw new Error('bad response');
      }

      setStatus('success');
    } catch {
      setStatus('error');
      setError('메시지 전송 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  if (status === 'success') {
    return (
      <div style={{ padding: '1rem' }}>
        <p>메시지가 성공적으로 전달되었습니다.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', maxWidth: 420, margin: '0 auto' }}>
      <p style={{ marginBottom: '0.75rem' }}>
        수신자는 해외 체류 중입니다.<br />
        아래에 메시지를 남기면 수신자에게 전달됩니다.
      </p>

      <form onSubmit={submitMessage}>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          style={{ width: '100%', marginBottom: '0.75rem' }}
        />
        <button type="submit">메시지 남기기</button>
      </form>

      {status === 'error' && (
        <p style={{ marginTop: '0.75rem' }}>{error}</p>
      )}
      {error && status !== 'error' && (
        <p style={{ marginTop: '0.75rem' }}>{error}</p>
      )}
    </div>
  );
}
