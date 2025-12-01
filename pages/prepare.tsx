import { useState } from 'react';

export default function Prepare() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notify, setNotify] = useState(false);
  const [messageType, setMessageType] = useState('reminder');
  const [contact, setContact] = useState('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // TODO: handle submit actions such as saving settings or making API call
    alert('설정이 저장되었습니다.');
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>출국 설정</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '400px' }}>
        <label>
          출국일:
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label>
          귀국일 또는 여행 기간:
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label>
          알림 받기:
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        </label>
        {notify && (
          <>
            <label>
              메시지 유형:
              <select value={messageType} onChange={(e) => setMessageType(e.target.value)}>
                <option value="reminder">여행 전 리마인더</option>
                <option value="daily">일일 알림</option>
                <option value="none">알림 없음</option>
              </select>
            </label>
            <label>
              연락처 (전화번호 또는 이메일):
              <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} required />
            </label>
          </>
        )}
        <button type="submit">설정 저장</button>
      </form>
    </div>
  );
}
