CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_event_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bid_submitted', 'bid_selected', 'order_completed')),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  title text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL,
  read_at timestamptz,
  emailed_at timestamptz,
  UNIQUE (source_event_id, account_id)
);

CREATE INDEX notifications_account_feed ON notifications (account_id, created_at DESC, id DESC);
CREATE INDEX notifications_account_unread ON notifications (account_id) WHERE read_at IS NULL;
