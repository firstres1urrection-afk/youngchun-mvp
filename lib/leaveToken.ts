import { Pool } from 'pg';
import { randomBytes } from 'crypto';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL,
});

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_links (
      token TEXT PRIMARY KEY,
      call_sid TEXT,
      from_number TEXT NOT NULL,
      to_number TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);
}

export interface CreateLeaveTokenInput {
  callSid?: string | null;
  fromNumber: string;
  toNumber: string;
}

export async function createLeaveToken(input: CreateLeaveTokenInput) {
  await ensureTable();
  const { callSid, fromNumber, toNumber } = input;
  if (callSid) {
    const { rows } = await pool.query(
      'SELECT token, expires_at, used_at FROM leave_links WHERE call_sid = $1 LIMIT 1',
      [callSid],
    );
    if (rows.length > 0) {
      const row = rows[0];
      const now = new Date();
      if (row.expires_at > now && !row.used_at) {
        return row.token;
      }
    }
  }
  const token = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO leave_links (token, call_sid, from_number, to_number, created_at, expires_at, status) VALUES ($1,$2,$3,$4,NOW(),$5,$6)',
    [token, callSid || null, fromNumber, toNumber, expiresAt, 'active'],
  );
  return token;
}

export interface ValidateLeaveTokenResult {
  valid: boolean;
  reason?: string;
}

export async function validateLeaveToken(token: string): Promise<ValidateLeaveTokenResult> {
  await ensureTable();
  const { rows } = await pool.query(
    'SELECT expires_at, used_at, status FROM leave_links WHERE token = $1 LIMIT 1',
    [token],
  );
  if (rows.length === 0) {
    return { valid: false, reason: 'not_found' };
  }
  const row = rows[0];
  const now = new Date();
  if (row.expires_at < now) {
    return { valid: false, reason: 'expired' };
  }
  if (row.used_at) {
    return { valid: false, reason: 'used' };
  }
  return { valid: true };
}
