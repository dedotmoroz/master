ALTER TABLE attachments
  ALTER COLUMN owner_id DROP NOT NULL;

ALTER TABLE attachments
  DROP CONSTRAINT attachments_purpose_check;

ALTER TABLE attachments
  ADD CONSTRAINT attachments_purpose_check
  CHECK (purpose IN ('profile_avatar', 'portfolio', 'guest_order'));

ALTER TABLE attachments
  ADD COLUMN guest_claim_token_hash char(64),
  ADD COLUMN claimed_submission_id uuid REFERENCES order_submissions(id);

ALTER TABLE attachments
  ADD CONSTRAINT attachments_ownership_shape CHECK (
    (
      purpose = 'guest_order'
      AND (
        (owner_id IS NULL AND guest_claim_token_hash IS NOT NULL)
        OR (owner_id IS NOT NULL AND guest_claim_token_hash IS NULL)
      )
    )
    OR (
      purpose IN ('profile_avatar', 'portfolio')
      AND owner_id IS NOT NULL
      AND guest_claim_token_hash IS NULL
      AND claimed_submission_id IS NULL
    )
  );

CREATE INDEX attachments_guest_claims
  ON attachments (claimed_submission_id)
  WHERE purpose = 'guest_order';
