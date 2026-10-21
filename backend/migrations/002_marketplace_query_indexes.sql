CREATE INDEX orders_public_category_feed
  ON orders (category_id, published_at DESC, id DESC)
  WHERE status = 'published';

CREATE INDEX orders_public_location_feed
  ON orders (location_id, published_at DESC, id DESC)
  WHERE status = 'published';

CREATE INDEX orders_public_category_location_feed
  ON orders (category_id, location_id, published_at DESC, id DESC)
  WHERE status = 'published';

CREATE INDEX bids_order_history
  ON bids (order_id, submitted_at DESC, id DESC);

CREATE INDEX bids_contractor_history
  ON bids (contractor_id, submitted_at DESC, id DESC);
