ALTER TABLE attachments
  DROP CONSTRAINT attachments_status_check;

ALTER TABLE attachments
  ADD CONSTRAINT attachments_status_check
  CHECK (status IN ('pending_upload', 'uploaded', 'cleanup_pending'));

ALTER TABLE attachments
  DROP CONSTRAINT attachments_status_shape;

ALTER TABLE attachments
  ADD CONSTRAINT attachments_status_shape CHECK (
    (status = 'pending_upload' AND uploaded_at IS NULL)
    OR (status = 'uploaded' AND uploaded_at IS NOT NULL)
    OR status = 'cleanup_pending'
  );

CREATE TABLE public_rate_limits (
  action text NOT NULL,
  client_key char(64) NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (action, client_key)
);

CREATE INDEX public_rate_limits_cleanup
  ON public_rate_limits (updated_at);
