-- Track how many people arrived after the initial check-in (late arrivals).
ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS initial_actual_party_size INTEGER,
  ADD COLUMN IF NOT EXISTS late_arrivals INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ;

-- Backfill: for existing rows, initial == current, no late arrivals yet.
UPDATE checkins
SET initial_actual_party_size = actual_party_size,
    late_arrivals = 0
WHERE initial_actual_party_size IS NULL;

ALTER TABLE checkins
  ALTER COLUMN initial_actual_party_size SET NOT NULL;

-- Add the late-arrival invariant only if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkins_late_le_expected'
      AND conrelid = 'checkins'::regclass
  ) THEN
    ALTER TABLE checkins
      ADD CONSTRAINT checkins_late_le_expected
      CHECK (late_arrivals >= 0
         AND actual_party_size = initial_actual_party_size + late_arrivals
         AND actual_party_size <= expected_party_size);
  END IF;
END
$$;