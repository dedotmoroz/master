-- Start retention when an unused file is first observed, not at its historic upload date.
ALTER TABLE attachments ADD COLUMN unreferenced_since timestamptz;
CREATE INDEX attachments_unused_account_cleanup
  ON attachments (unreferenced_since, id) WHERE owner_id IS NOT NULL;
