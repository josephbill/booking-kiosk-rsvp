-- Drop the unique constraint that prevented multiple invitations to the same email
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_event_id_invitee_email_key;