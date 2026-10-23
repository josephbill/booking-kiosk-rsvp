-- 1. Create communities table
CREATE TABLE IF NOT EXISTS communities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Add community_id to invitations
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS community_id INTEGER REFERENCES communities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invitations_community ON invitations(community_id);

-- 3. Backfill an "Unassigned" community for existing data
INSERT INTO communities (name) VALUES ('Unassigned') ON CONFLICT DO NOTHING;

UPDATE invitations
SET community_id = (SELECT id FROM communities WHERE name = 'Unassigned' LIMIT 1)
WHERE community_id IS NULL;