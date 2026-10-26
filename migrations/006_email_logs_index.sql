-- Speed up lookups of the most recent email log per invitation
CREATE INDEX IF NOT EXISTS idx_email_logs_invitation_type_created
  ON email_logs (invitation_id, email_type, created_at DESC);

-- Speed up filtering by delivery status
CREATE INDEX IF NOT EXISTS idx_email_logs_status_created
  ON email_logs (delivery_status, created_at DESC);