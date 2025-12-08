import React from 'react';
import { GetServerSideProps } from 'next';
import { sql } from '@vercel/postgres';

interface CallForwardData {
  twilio_number: string;
  expire_at: string;
  daysLeft: number;
}

interface PreparePageProps {
  data: CallForwardData | null;
  prepareCompleted: boolean;
}

const formatDate = (isoDate: string) => {
  const date = new Date(isoDate);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
};

const Prepare: React.FC<PreparePageProps> = ({ data, prepareCompleted }) => {
  const statusMessage = prepareCompleted ? (
    <p style={{ color: '#28a745', fontWeight: 'bold' }}>✔ 착신전환 설정이 완료되었습니다.</p>
  ) : (
    <p style={{ color: '#777', fontWeight: 'bold' }}>아직 착신전환 설정이 완료되지 않았습니다.</p>
  );

  if (!data) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1>출국 준비 설정</h1>
        {statusMessage}
        <p>현재 사용 가능한 안내 번호가 없습니다.</p>
        <p>결제 후 이 페이지를 다시 열어주세요.</p>
      </div>
    );
  }

  const dialNumber = data.twilio_number.replace(/^\+/, '');

  return (
    <div style={{ padding: '2rem' }}>
      <h1>출국 준비 설정</h1>
      {statusMessage}
      <div style={{ marginTop: '1rem' }}>
        <p><strong>발급된 안내 번호:</strong> {data.twilio_number}</p>
        <p style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.25rem' }}>📞 이 번호는 병찬님께 현재 배정된 해외 안내 번호입니다.</p>
        <p><strong>이용 만료 일시:</strong> {formatDate(data.expire_at)} (KST)</p>
        <p><strong>남은 기간:</strong> D-{data.daysLeft}</p>
      </div>
      <div style={{ marginTop: '1rem' }}>
        <a
          href={'tel:**62*' + dialNumber + '#'}
          style={{
            display: 'block',
            marginBottom: '1rem',
            padding: '0.75rem',
            backgroundColor: '#0070f3',
            color: 'white',
            textAlign: 'center',
            textDecoration: 'none',
            borderRadius: '4px',
          }}
        >
          착신전환 켜기 (무응답 시 Twilio 번호로 연결)
        </a>
        <a
          href="tel:##004#"
          style={{
            display: 'block',
            padding: '0.75rem',
            backgroundColor: '#e53e3e',
            color: 'white',
            textAlign: 'center',
            textDecoration: 'none',
            borderRadius: '4px',
          }}
        >
          착신전환 전체 해제
        </a>
        <button
          onClick={() => {
            const cookie = document.cookie.split('; ').find((row) => row.startsWith('user_id='));
            const userId = cookie ? cookie.split('=')[1] : null;
            fetch('/api/prepare/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(userId ? { user_id: userId } : {}),
            }).then(() => {
              alert('착신전환 설정 완료되었습니다.');
              window.location.reload();
            });
          }}
          style={{
            display: 'block',
            marginTop: '1rem',
            marginBottom: '1rem',
            padding: '0.75rem',
            backgroundColor: '#28a745',
            color: 'white',
            textAlign: 'center',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          착신전환 설정 완료
        </button>
        <p style={{ fontSize: '0.9rem', color: '#555' }}>
          출국 직전에 위 버튼으로 착신전환을 켜두면, 국내 번호로 오는 전화가 위 안내 번호로 연결됩니다. 귀국 후에는 반드시 착신전환 해제를 해주세요. 국내에서 테스트용으로 켜지 않는 것을 권장합니다.
        </p>
      </div>
    </div>
  );
};

export const getServerSideProps: GetServerSideProps<PreparePageProps> = async (context) => {
  const { req, query } = context;
  const userIdFromCookie = (req as any).cookies?.user_id || null;
  const userIdFromQuery = typeof query.user_id === 'string' ? query.user_id : null;
  const userId = userIdFromCookie || userIdFromQuery;

  let prepareCompleted = false;

  try {
    if (userId) {
      const prepareResult = await sql`
        SELECT prepare_completed
        FROM prepare_status
        WHERE user_id = ${userId}
        ORDER BY id DESC
        LIMIT 1
      `;
      if (prepareResult.rows.length > 0) {
        prepareCompleted = prepareResult.rows[0].prepare_completed as any;
      }
    }
  } catch (err) {
    console.error('Error fetching prepare_status:', err);
  }

  let row: any = null;

  try {
    if (userId) {
      const result = await sql`
        SELECT twilio_number, expire_at
        FROM call_forward_numbers
        WHERE user_id = ${userId}
          AND is_released = false
          AND expire_at > NOW()
        ORDER BY expire_at DESC
        LIMIT 1
      `;
      row = result.rows[0] || null;
    } else {
      const result = await sql`
        SELECT twilio_number, expire_at
        FROM call_forward_numbers
        WHERE is_released = false
          AND expire_at > NOW()
        ORDER BY expire_at DESC
        LIMIT 1
      `;
      row = result.rows[0] || null;
    }
  } catch (err) {
    console.error('Error fetching call_forward_numbers:', err);
  }

  if (!row) {
    return { props: { data: null, prepareCompleted } };
  }

  const expireAt = new Date(row.expire_at as any);
  const now = new Date();
  const daysLeft = Math.ceil((expireAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return {
    props: {
      data: {
        twilio_number: row.twilio_number,
        expire_at: row.expire_at as any,
        daysLeft,
      },
      prepareCompleted,
    },
  };
};

export default Prepare;
