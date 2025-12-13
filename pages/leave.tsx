export default function LeavePage() {
  return (
    <div style={{ padding: "2rem", maxWidth: 600, margin: "0 auto" }}>
      <h1>메시지를 남겨주세요</h1>

      <form method="POST" action="/api/leave">
        <textarea
          name="message"
          rows={6}
          required
          style={{ width: "100%", marginBottom: "1rem" }}
        />
        <button type="submit">전송</button>
      </form>
    </div>
  );
}
