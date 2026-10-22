const { withTransaction, pool } = require('../config/db');
const { hashToken } = require('../utils/tokens');

async function validateAndCheckin(rawToken, staffId) {
  const hash = hashToken(rawToken);
  return withTransaction(async (client) => {
    // Find credential
    const qrRes = await client.query(
      `SELECT qc.*, i.id AS inv_id, i.rsvp_status, i.confirmed_party_size, i.invitee_name,
              i.invitee_email, i.max_party_size
       FROM qr_credentials qc
       JOIN invitations i ON i.id = qc.invitation_id
       WHERE qc.qr_reference_hash = $1
       FOR UPDATE OF qc`,
      [hash]
    );
    if (!qrRes.rows.length) {
      return { ok: false, reason: 'INVALID', message: 'QR code not recognized.' };
    }
    const qc = qrRes.rows[0];
    if (qc.credential_status !== 'active') {
      return { ok: false, reason: 'REVOKED', message: 'This QR code has been revoked.' };
    }
    if (qc.rsvp_status === 'declined') {
      return { ok: false, reason: 'DECLINED', message: 'Party declined the invitation.' };
    }
    if (qc.rsvp_status !== 'accepted') {
      return { ok: false, reason: 'NOT_ACCEPTED', message: 'Party has not confirmed attendance.' };
    }

    // Try to insert check-in; unique constraint prevents duplicates
    try {
      const ins = await client.query(
        `INSERT INTO checkins (invitation_id, party_size, staff_id, qr_credential_id)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [qc.inv_id, qc.confirmed_party_size, staffId, qc.id]
      );
      return {
        ok: true,
        checkin: ins.rows[0],
        invitation: {
          id: qc.inv_id,
          name: qc.invitee_name,
          partySize: qc.confirmed_party_size,
        },
      };
    } catch (e) {
      if (e.code === '23505') {
        // Already checked in
        const existing = await client.query(
          `SELECT c.*, u.name AS staff_name FROM checkins c
           LEFT JOIN users u ON u.id=c.staff_id
           WHERE c.invitation_id=$1`,
          [qc.inv_id]
        );
        return {
          ok: false, reason: 'ALREADY_CHECKED_IN',
          message: 'Already checked in.',
          existing: existing.rows[0],
          invitation: { name: qc.invitee_name, partySize: qc.confirmed_party_size },
        };
      }
      throw e;
    }
  });
}

async function getSummary() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM invitations) AS total_invitations,
      (SELECT COUNT(*) FROM invitations WHERE rsvp_status='accepted') AS total_accepted,
      (SELECT COUNT(*) FROM invitations WHERE rsvp_status='declined') AS total_declined,
      (SELECT COUNT(*) FROM invitations WHERE rsvp_status='pending') AS total_pending,
      (SELECT COALESCE(SUM(confirmed_party_size),0) FROM invitations WHERE rsvp_status='accepted') AS expected_attendees,
      (SELECT COUNT(*) FROM checkins) AS checked_in_parties,
      (SELECT COALESCE(SUM(party_size),0) FROM checkins) AS actual_attendees,
      (SELECT COUNT(*) FROM email_logs WHERE delivery_status='failed') AS failed_emails
  `);
  return rows[0];
}

module.exports = { validateAndCheckin, getSummary };