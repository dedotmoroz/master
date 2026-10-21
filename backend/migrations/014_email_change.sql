CREATE TABLE email_change_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  previous_email text NOT NULL CHECK (previous_email = lower(btrim(previous_email))),
  new_email text NOT NULL CHECK (new_email = lower(btrim(new_email))),
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'consumed', 'revoked')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  CHECK (previous_email <> new_email)
);

CREATE UNIQUE INDEX email_change_one_pending_per_account
  ON email_change_requests(account_id) WHERE status = 'pending';
