-- Track both the expected party size (from the RSVP) and the actual admitted size.
ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS expected_party_size INTEGER,
  ADD COLUMN IF NOT EXISTS actual_party_size   INTEGER;

-- Backfill existing rows: assume everyone showed up.
UPDATE checkins
SET expected_party_size = COALESCE(expected_party_size, party_size),
    actual_party_size   = COALESCE(actual_party_size,   party_size)
WHERE expected_party_size IS NULL OR actual_party_size IS NULL;

-- Enforce invariants (added after backfill so existing rows pass).
ALTER TABLE checkins
  ALTER COLUMN expected_party_size SET NOT NULL,
  ALTER COLUMN actual_party_size   SET NOT NULL;

ALTER TABLE checkins
  ADD CONSTRAINT checkins_actual_le_expected
    CHECK (actual_party_size >= 1 AND actual_party_size <= expected_party_size);

-- Helpful index for dashboard aggregation
CREATE INDEX IF NOT EXISTS idx_checkins_event_aggregate
  ON checkins (invitation_id, actual_party_size);