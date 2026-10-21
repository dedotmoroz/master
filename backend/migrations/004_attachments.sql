CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('profile_avatar', 'portfolio')),
  original_file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending_upload', 'uploaded')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachments_expiry CHECK (expires_at > created_at),
  CONSTRAINT attachments_status_shape CHECK (
    (status = 'pending_upload' AND uploaded_at IS NULL)
    OR (status = 'uploaded' AND uploaded_at IS NOT NULL)
  )
);

CREATE INDEX attachments_owner_history ON attachments (owner_id, created_at DESC);
CREATE INDEX attachments_pending_expiry ON attachments (expires_at) WHERE status = 'pending_upload';
