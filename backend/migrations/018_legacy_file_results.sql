CREATE TABLE legacy_file_import_results (
  source_table text NOT NULL,
  legacy_id bigint NOT NULL,
  attachment_id uuid REFERENCES attachments(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('ready', 'skipped')),
  reason text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_table, legacy_id)
);
