-- Keep the original +/-1 for provenance and repeatable imports; expose only the agreed 1-5 score.
ALTER TABLE legacy_profile_reviews
  ADD COLUMN rating_score smallint GENERATED ALWAYS AS (
    CASE WHEN score = 1 THEN 5 ELSE 2 END
  ) STORED,
  ADD COLUMN status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'hidden', 'disputed'));

CREATE INDEX legacy_profile_reviews_published_rating
  ON legacy_profile_reviews(subject_id, rating_score) WHERE status = 'published';

-- One read model shared by feeds, counts, averages, filters and sorting.
-- A legacy review has no order: never create a fictitious completed deal.
CREATE VIEW reputation_reviews AS
  SELECT id, order_id, author_id, subject_id, score, text, status, created_at,
         'order'::text AS origin
  FROM reviews
  UNION ALL
  SELECT id, NULL::uuid AS order_id, author_id, subject_id, rating_score AS score,
         text, status, created_at, 'legacy'::text AS origin
  FROM legacy_profile_reviews;
