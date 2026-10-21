CREATE TABLE account_deletion_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email))),
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'consumed', 'revoked')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX account_deletion_one_pending ON account_deletion_requests(account_id) WHERE status = 'pending';

CREATE TABLE account_erasure_jobs (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  deleted_at timestamptz NOT NULL,
  history_erased boolean NOT NULL DEFAULT false
);
