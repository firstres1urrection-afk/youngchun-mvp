-- Add push_sent_at column to call_events
ALTER TABLE call_events
ADD COLUMN IF NOT EXISTS push_sent_at TIMESTAMPTZ NULL;
