CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS call_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    call_sid varchar NOT NULL UNIQUE,
    user_id uuid NOT NULL,
    from_number varchar,
    to_number varchar,
    call_status varchar,
    created_at timestamptz DEFAULT now()
);
