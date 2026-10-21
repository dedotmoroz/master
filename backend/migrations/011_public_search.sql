CREATE INDEX orders_public_full_text_search
  ON orders USING gin (
    to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(description, ''))
  )
  WHERE status = 'published';

CREATE INDEX orders_public_budget_low
  ON orders (COALESCE(budget_min_minor, budget_max_minor), published_at DESC, id DESC)
  WHERE status = 'published';

CREATE INDEX orders_public_budget_high
  ON orders (COALESCE(budget_max_minor, budget_min_minor), published_at DESC, id DESC)
  WHERE status = 'published';

CREATE INDEX contractor_profiles_public_full_text_search
  ON contractor_profiles USING gin (
    to_tsvector('russian', coalesce(display_name, '') || ' ' || coalesce(bio, ''))
  );

CREATE INDEX reviews_published_subject_rating
  ON reviews (subject_id, score)
  WHERE status = 'published';

CREATE INDEX orders_completed_contractor
  ON orders (contractor_id, completed_at DESC)
  WHERE status = 'completed';
