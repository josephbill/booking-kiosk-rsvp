-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Events
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  event_date TIMESTAMPTZ NOT NULL,
  venue TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Invitations
CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  invitee_name TEXT NOT NULL,
  invitee_email TEXT NOT NULL,
  invitation_token TEXT NOT NULL UNIQUE,
  max_party_size INTEGER NOT NULL DEFAULT 4 CHECK (max_party_size BETWEEN 1 AND 20),
  rsvp_status TEXT NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending','accepted','declined','reopened')),
  confirmed_party_size INTEGER,
  response_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, invitee_email)
);
CREATE INDEX IF NOT EXISTS idx_invitations_event ON invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(rsvp_status);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(invitation_token);

-- QR credentials
CREATE TABLE IF NOT EXISTS qr_credentials (
  id SERIAL PRIMARY KEY,
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  qr_reference_hash TEXT NOT NULL UNIQUE,
  credential_status TEXT NOT NULL DEFAULT 'active' CHECK (credential_status IN ('active','revoked')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_qr_invitation ON qr_credentials(invitation_id);
CREATE INDEX IF NOT EXISTS idx_qr_hash ON qr_credentials(qr_reference_hash);

-- Check-ins: one per invitation (unique constraint)
CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  invitation_id INTEGER NOT NULL UNIQUE REFERENCES invitations(id) ON DELETE CASCADE,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  staff_id INTEGER REFERENCES users(id),
  qr_credential_id INTEGER REFERENCES qr_credentials(id)
);

-- Email logs
CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  invitation_id INTEGER REFERENCES invitations(id) ON DELETE CASCADE,
  email_type TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_logs_invitation ON email_logs(invitation_id);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Session table (created by connect-pg-simple but ensure schema)
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");