CREATE TABLE email_auth_requests (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('registration', 'login')),
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'consumed')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT email_auth_requests_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT email_auth_requests_expiry CHECK (expires_at > created_at),
  CONSTRAINT email_auth_requests_status_shape CHECK (
    (status = 'pending' AND consumed_at IS NULL AND account_id IS NULL)
    OR (status = 'consumed' AND consumed_at IS NOT NULL AND account_id IS NOT NULL)
  )
);

CREATE INDEX email_auth_requests_pending_expiry
  ON email_auth_requests (expires_at)
  WHERE status = 'pending';

CREATE INDEX email_auth_requests_email_history
  ON email_auth_requests (email, created_at DESC);
