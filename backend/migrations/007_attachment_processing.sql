ALTER TABLE attachments
  ADD COLUMN processed_at timestamptz,
  ADD COLUMN safe_storage_key text,
  ADD COLUMN safe_content_type text,
  ADD COLUMN safe_size_bytes bigint,
  ADD COLUMN preview_storage_key text,
  ADD COLUMN rejection_reason text;

ALTER TABLE attachments
  DROP CONSTRAINT attachments_status_check,
  DROP CONSTRAINT attachments_status_shape;

UPDATE attachments
SET status = 'processing'
WHERE status = 'uploaded';

INSERT INTO outbox_events (
  id, event_type, aggregate_type, aggregate_id, payload, occurred_at
)
SELECT
  md5(a.id::text || ':attachment-processing-v1')::uuid,
  'AttachmentProcessingRequested',
  'Attachment',
  a.id,
  jsonb_build_object('ownerId', a.owner_id, 'purpose', a.purpose),
  a.uploaded_at
FROM attachments a
WHERE a.status = 'processing';

ALTER TABLE attachments
  ADD CONSTRAINT attachments_status_check
    CHECK (status IN ('pending_upload', 'processing', 'ready', 'rejected', 'cleanup_pending')),
  ADD CONSTRAINT attachments_safe_size
    CHECK (safe_size_bytes IS NULL OR safe_size_bytes > 0),
  ADD CONSTRAINT attachments_status_shape CHECK (
    (
      status = 'pending_upload'
      AND uploaded_at IS NULL
      AND processed_at IS NULL
      AND safe_storage_key IS NULL
      AND rejection_reason IS NULL
    )
    OR (
      status = 'processing'
      AND uploaded_at IS NOT NULL
      AND processed_at IS NULL
      AND safe_storage_key IS NULL
      AND rejection_reason IS NULL
    )
    OR (
      status = 'ready'
      AND uploaded_at IS NOT NULL
      AND processed_at IS NOT NULL
      AND safe_storage_key IS NOT NULL
      AND safe_content_type IS NOT NULL
      AND safe_size_bytes IS NOT NULL
      AND rejection_reason IS NULL
    )
    OR (
      status = 'rejected'
      AND uploaded_at IS NOT NULL
      AND processed_at IS NOT NULL
      AND safe_storage_key IS NULL
      AND safe_content_type IS NULL
      AND safe_size_bytes IS NULL
      AND preview_storage_key IS NULL
      AND rejection_reason IS NOT NULL
    )
    OR status = 'cleanup_pending'
  );

CREATE UNIQUE INDEX attachments_safe_storage_key_unique
  ON attachments (safe_storage_key)
  WHERE safe_storage_key IS NOT NULL;

CREATE INDEX attachments_processing
  ON attachments (uploaded_at)
  WHERE status = 'processing';
