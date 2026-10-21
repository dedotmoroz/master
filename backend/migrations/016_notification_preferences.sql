CREATE TABLE notification_preferences (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  email_bid_submitted boolean NOT NULL DEFAULT true,
  email_bid_selected boolean NOT NULL DEFAULT true,
  email_order_completed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ADD COLUMN email_skipped_at timestamptz;
ALTER TABLE notifications ADD CONSTRAINT notifications_email_delivery_shape
  CHECK (emailed_at IS NULL OR email_skipped_at IS NULL);
