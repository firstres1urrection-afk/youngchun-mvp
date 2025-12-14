import { GetServerSideProps } from 'next';
import { sql } from '@vercel/postgres';

interface Props {
  message: string | null;
}

export default function ViewPage({ message }: Props) {
  if (!message) {
    return <div>메시지를 찾을 수 없습니다.</div>;
  }
  return (
    <div>
      <p>{message}</p>
      <p>이 메시지는 해외 체류 중 전달되었습니다</p>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const { messageId } = context.query;
  const id = parseInt(
    Array.isArray(messageId) ? messageId[0] : (messageId as string),
    10
  );
  if (!id || isNaN(id)) {
    return { props: { message: null } };
  }
  try {
    const result = await sql`SELECT message FROM leave_messages WHERE id = ${id}`;
    if (result.rows.length === 0) {
      return { props: { message: null } };
    }
    return { props: { message: result.rows[0].message as string } };
  } catch (error) {
    console.error('Error retrieving message:', error);
    return { props: { message: null } };
  }
};
