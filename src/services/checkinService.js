const { withTransaction, pool } = require('../config/db');
const { hashToken } = require('../utils/tokens');

async function validateAndCheckin(rawToken, staffId, actualPartySize) {
  const hash = hashToken(rawToken);
  return withTransaction(async (client) => {
    const qrRes = await client.query(
      `SELECT qc.*, i.id AS inv_id, i.rsvp_status, i.confirmed_party_size,
              i.invitee_name, i.invitee_email, i.max_party_size
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

    // Validate actual party size against confirmed party size
    const expected = qc.confirmed_party_size;
    const actual = parseInt(actualPartySize, 10);
    if (!Number.isInteger(actual) || actual < 1 || actual > expected) {
      return {
        ok: false,
        reason: 'INVALID_PARTY_SIZE',
        message: `Admitted count must be between 1 and ${expected}.`,
        invitation: { name: qc.invitee_name, partySize: expected },
      };
    }

    try {
      const ins = await client.query(
        `INSERT INTO checkins
           (invitation_id, party_size, expected_party_size, actual_party_size,
            staff_id, qr_credential_id)
         VALUES ($1, $2, $2, $3, $4, $5)
         RETURNING *`,
        [qc.inv_id, expected, actual, staffId, qc.id]
      );
      return {
        ok: true,
        checkin: ins.rows[0],
        invitation: {
          id: qc.inv_id,
          name: qc.invitee_name,
          expectedPartySize: expected,
          actualPartySize: actual,
        },
      };
    } catch (e) {
      if (e.code === '23505') {
        const existing = await client.query(
          `SELECT c.*, u.name AS staff_name FROM checkins c
           LEFT JOIN users u ON u.id = c.staff_id
           WHERE c.invitation_id = $1`,
          [qc.inv_id]
        );
        return {
          ok: false,
          reason: 'ALREADY_CHECKED_IN',
          message: 'Already checked in.',
          existing: existing.rows[0],
          invitation: { name: qc.invitee_name, expectedPartySize: expected },
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

      (SELECT COALESCE(SUM(confirmed_party_size),0)
         FROM invitations WHERE rsvp_status='accepted') AS expected_attendees,

      (SELECT COUNT(*) FROM checkins) AS checked_in_parties,

      -- Expected headcount across only the parties that actually showed up
      (SELECT COALESCE(SUM(expected_party_size),0) FROM checkins) AS expected_attending,

      -- Actual people who arrived
      (SELECT COALESCE(SUM(actual_party_size),0) FROM checkins) AS actual_attendees,

      -- The "no-show inside a party" delta
      (SELECT COALESCE(SUM(expected_party_size - actual_party_size),0)
         FROM checkins) AS no_show_attendees,

      (SELECT COUNT(*) FROM email_logs WHERE delivery_status='failed') AS failed_emails
  `);
  return rows[0];
}

module.exports = { validateAndCheckin, getSummary };