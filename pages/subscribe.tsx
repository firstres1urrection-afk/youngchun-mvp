import { useState } from 'react';

export default function Subscribe() {
  const handleClick = async () => {
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error(error);
      alert('결제 세션 생성 중 오류가 발생했습니다.');
    }
  };
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Youngchun 해외 전화 실시간 알림</h1>
      <p>월 9,900원 / 언제든 해지</p>
      <button onClick={handleClick}>구독 시작하기</button>
    </div>
  );
}
