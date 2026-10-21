CREATE TABLE bid_messages (
  id uuid PRIMARY KEY,
  bid_id uuid NOT NULL REFERENCES bids(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  author_id uuid NOT NULL REFERENCES accounts(id),
  client_message_id uuid NOT NULL,
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL,
  UNIQUE (bid_id, author_id, client_message_id)
);
CREATE INDEX bid_messages_thread ON bid_messages(bid_id, created_at DESC, id DESC);
CREATE INDEX legacy_bid_messages_thread ON legacy_bid_messages(bid_id, created_at DESC, id DESC);

CREATE VIEW bid_conversation_messages AS
  SELECT m.id, m.bid_id, m.order_id, m.author_id, m.text, m.created_at, 'new'::text AS origin
  FROM bid_messages m JOIN bids b ON b.id=m.bid_id JOIN orders o ON o.id=b.order_id
  WHERE m.order_id=b.order_id AND m.author_id IN (b.contractor_id,o.customer_id)
  UNION ALL
  SELECT m.id, m.bid_id, m.order_id, m.author_id, m.text, m.created_at, 'legacy'::text AS origin
  FROM legacy_bid_messages m JOIN bids b ON b.id=m.bid_id JOIN orders o ON o.id=b.order_id
  WHERE m.order_id=b.order_id AND (m.author_id IS NULL OR m.author_id IN (b.contractor_id,o.customer_id));

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('bid_submitted','bid_selected','order_completed','message_received'));
ALTER TABLE notifications ADD COLUMN bid_id uuid REFERENCES bids(id);
ALTER TABLE notifications ADD CONSTRAINT notifications_message_shape
  CHECK ((kind='message_received' AND bid_id IS NOT NULL) OR (kind<>'message_received' AND bid_id IS NULL));
ALTER TABLE notification_preferences ADD COLUMN email_message_received boolean NOT NULL DEFAULT true;
