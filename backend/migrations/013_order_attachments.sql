ALTER TABLE attachments DROP CONSTRAINT attachments_purpose_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_purpose_check
  CHECK (purpose IN ('profile_avatar', 'portfolio', 'guest_order', 'order'));

ALTER TABLE attachments DROP CONSTRAINT attachments_ownership_shape;
ALTER TABLE attachments ADD CONSTRAINT attachments_ownership_shape CHECK (
  (purpose = 'guest_order' AND (
    (owner_id IS NULL AND guest_claim_token_hash IS NOT NULL)
    OR (owner_id IS NOT NULL AND guest_claim_token_hash IS NULL)
  ))
  OR (
    purpose IN ('profile_avatar', 'portfolio', 'order')
    AND owner_id IS NOT NULL
    AND guest_claim_token_hash IS NULL
    AND claimed_submission_id IS NULL
  )
);
