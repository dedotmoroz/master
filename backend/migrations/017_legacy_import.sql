CREATE TABLE legacy_import_runs (
  source_sha256 char(64) PRIMARY KEY,
  importer_version text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL
);
CREATE TABLE legacy_import_entities (
  source_table text NOT NULL,
  legacy_id bigint NOT NULL,
  target_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (source_table, legacy_id)
);
CREATE INDEX legacy_import_entities_account ON legacy_import_entities(account_id);
CREATE TABLE legacy_profile_reviews (
  id uuid PRIMARY KEY,
  legacy_id bigint NOT NULL UNIQUE,
  author_id uuid NOT NULL REFERENCES accounts(id),
  subject_id uuid NOT NULL REFERENCES accounts(id),
  score smallint NOT NULL CHECK (score IN (-1, 1)),
  text text NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (author_id <> subject_id)
);
CREATE INDEX legacy_profile_reviews_subject ON legacy_profile_reviews(subject_id, created_at DESC);
-- Old repeated offers are revisions, not fictitious contractor withdrawals/rejections.
CREATE TABLE legacy_bid_versions (
  id uuid PRIMARY KEY,
  legacy_id bigint NOT NULL UNIQUE,
  bid_id uuid NOT NULL REFERENCES bids(id),
  contractor_id uuid NOT NULL REFERENCES accounts(id),
  message text NOT NULL,
  original_choice text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
  submitted_at timestamptz NOT NULL
);
CREATE TABLE legacy_bid_messages (
  id uuid PRIMARY KEY,
  legacy_id bigint NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES orders(id),
  bid_id uuid REFERENCES bids(id),
  author_id uuid REFERENCES accounts(id),
  legacy_author_id bigint NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL
);
