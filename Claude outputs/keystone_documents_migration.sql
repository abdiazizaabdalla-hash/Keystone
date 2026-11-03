-- Keystone TC: documents table for per-task/per-transaction file uploads
-- Run this in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  task_id uuid,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  content_type text,
  file_size bigint,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_transaction_id_idx ON documents(transaction_id);
CREATE INDEX IF NOT EXISTS documents_task_id_idx ON documents(task_id);

-- Same grant pattern as your other tables (RLS/grants were the earlier
-- "permission denied" root cause, so this avoids repeating that).
GRANT ALL ON documents TO anon, authenticated, service_role;
