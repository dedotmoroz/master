CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_email_normalized CHECK (email = lower(btrim(email)))
);

CREATE UNIQUE INDEX accounts_email_unique ON accounts (lower(email));

CREATE TABLE account_capabilities (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN ('customer', 'contractor', 'admin')),
  PRIMARY KEY (account_id, capability)
);

CREATE TABLE order_submissions (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  contact_name text NOT NULL,
  category_id text NOT NULL,
  location_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  budget_min_minor bigint,
  budget_max_minor bigint,
  budget_currency char(3) NOT NULL DEFAULT 'RUB',
  temporary_attachment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  consent_version text NOT NULL,
  token_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_email', 'confirmed', 'expired')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  account_id uuid REFERENCES accounts(id),
  order_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_submissions_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT order_submissions_expiry CHECK (expires_at > created_at),
  CONSTRAINT order_submissions_budget_nonnegative CHECK (
    (budget_min_minor IS NULL OR budget_min_minor >= 0)
    AND (budget_max_minor IS NULL OR budget_max_minor >= 0)
  ),
  CONSTRAINT order_submissions_budget_range CHECK (
    budget_min_minor IS NULL OR budget_max_minor IS NULL OR budget_min_minor <= budget_max_minor
  ),
  CONSTRAINT order_submissions_confirmation_shape CHECK (
    (status = 'confirmed' AND confirmed_at IS NOT NULL AND account_id IS NOT NULL AND order_id IS NOT NULL)
    OR (status <> 'confirmed' AND confirmed_at IS NULL AND account_id IS NULL AND order_id IS NULL)
  )
);

CREATE UNIQUE INDEX order_submissions_token_hash_unique ON order_submissions (token_hash);
CREATE INDEX order_submissions_pending_expiry ON order_submissions (expires_at) WHERE status = 'pending_email';

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES accounts(id),
  category_id text NOT NULL,
  location_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  budget_min_minor bigint,
  budget_max_minor bigint,
  budget_currency char(3) NOT NULL DEFAULT 'RUB',
  attachment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'in_progress', 'completed', 'cancelled')),
  selected_bid_id uuid,
  contractor_id uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_budget_nonnegative CHECK (
    (budget_min_minor IS NULL OR budget_min_minor >= 0)
    AND (budget_max_minor IS NULL OR budget_max_minor >= 0)
  ),
  CONSTRAINT orders_budget_range CHECK (
    budget_min_minor IS NULL OR budget_max_minor IS NULL OR budget_min_minor <= budget_max_minor
  ),
  CONSTRAINT orders_assignment_shape CHECK (
    (status IN ('in_progress', 'completed') AND selected_bid_id IS NOT NULL AND contractor_id IS NOT NULL)
    OR (status NOT IN ('in_progress', 'completed') AND selected_bid_id IS NULL AND contractor_id IS NULL)
  )
);

CREATE INDEX orders_public_feed ON orders (published_at DESC) WHERE status = 'published';
CREATE INDEX orders_customer_history ON orders (customer_id, created_at DESC);

CREATE TABLE bids (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES accounts(id),
  message text NOT NULL,
  price_min_minor bigint,
  price_max_minor bigint,
  price_currency char(3) NOT NULL DEFAULT 'RUB',
  duration_days_min integer,
  duration_days_max integer,
  visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
  status text NOT NULL CHECK (status IN ('submitted', 'selected', 'rejected', 'withdrawn', 'cancelled')),
  submitted_at timestamptz NOT NULL,
  decided_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bids_price_nonnegative CHECK (
    (price_min_minor IS NULL OR price_min_minor >= 0)
    AND (price_max_minor IS NULL OR price_max_minor >= 0)
  ),
  CONSTRAINT bids_price_range CHECK (
    price_min_minor IS NULL OR price_max_minor IS NULL OR price_min_minor <= price_max_minor
  ),
  CONSTRAINT bids_duration_positive CHECK (
    (duration_days_min IS NULL OR duration_days_min > 0)
    AND (duration_days_max IS NULL OR duration_days_max > 0)
  ),
  CONSTRAINT bids_duration_range CHECK (
    duration_days_min IS NULL OR duration_days_max IS NULL OR duration_days_min <= duration_days_max
  )
);

CREATE UNIQUE INDEX bids_one_active_per_contractor
  ON bids (order_id, contractor_id)
  WHERE status IN ('submitted', 'selected');

CREATE UNIQUE INDEX bids_one_selected_per_order
  ON bids (order_id)
  WHERE status = 'selected';

ALTER TABLE orders
  ADD CONSTRAINT orders_selected_bid_fk
  FOREIGN KEY (selected_bid_id) REFERENCES bids(id);

ALTER TABLE order_submissions
  ADD CONSTRAINT order_submissions_order_fk
  FOREIGN KEY (order_id) REFERENCES orders(id);

CREATE TABLE reviews (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  author_id uuid NOT NULL REFERENCES accounts(id),
  subject_id uuid NOT NULL REFERENCES accounts(id),
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  text text NOT NULL,
  status text NOT NULL CHECK (status IN ('published', 'hidden', 'disputed')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_not_self CHECK (author_id <> subject_id),
  UNIQUE (order_id, author_id, subject_id)
);

CREATE INDEX reviews_subject_feed ON reviews (subject_id, created_at DESC) WHERE status = 'published';

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT sessions_expiry CHECK (expires_at > created_at)
);

CREATE INDEX sessions_account_active ON sessions (account_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX outbox_events_pending
  ON outbox_events (available_at, occurred_at)
  WHERE processed_at IS NULL;
