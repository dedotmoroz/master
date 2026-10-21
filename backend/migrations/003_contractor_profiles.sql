CREATE TABLE contractor_profiles (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  avatar_attachment_id text,
  specialization_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  service_location_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  portfolio jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT contractor_profiles_display_name_nonblank CHECK (length(btrim(display_name)) > 0),
  CONSTRAINT contractor_profiles_specializations_array CHECK (jsonb_typeof(specialization_ids) = 'array'),
  CONSTRAINT contractor_profiles_locations_array CHECK (jsonb_typeof(service_location_ids) = 'array'),
  CONSTRAINT contractor_profiles_portfolio_array CHECK (jsonb_typeof(portfolio) = 'array')
);

CREATE INDEX contractor_profiles_specializations
  ON contractor_profiles USING gin (specialization_ids);

CREATE INDEX contractor_profiles_service_locations
  ON contractor_profiles USING gin (service_location_ids);
