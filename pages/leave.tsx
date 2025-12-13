const LeavePage = () => (
  <div style={{ padding: '1rem' }}>
    <form method="POST" action="/api/leave">
      <textarea name="message" style={{ width: '100%', height: '150px', marginBottom: '1rem' }} />
      <button type="submit">Send</button>
    </form>
  </div>
);

export default LeavePage;
