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

async function addLateArrivals(rawToken, staffId, additionalCount) {
  const hash = hashToken(rawToken);
  return withTransaction(async (client) => {
    // Lock the checkin row so two staff don't race each other
    const ciRes = await client.query(
      `SELECT c.*, i.invitee_name, i.confirmed_party_size, i.rsvp_status
       FROM checkins c
       JOIN invitations i ON i.id = c.invitation_id
       JOIN qr_credentials qc ON qc.invitation_id = i.id
       WHERE qc.qr_reference_hash = $1
         AND qc.credential_status = 'active'
       FOR UPDATE OF c`,
      [hash]
    );

    if (!ciRes.rows.length) {
      return { ok: false, reason: 'NO_CHECKIN', message: 'No active check-in found for this code.' };
    }

    const row = ciRes.rows[0];
    const additional = parseInt(additionalCount, 10);
    if (!Number.isInteger(additional) || additional < 1) {
      return { ok: false, reason: 'INVALID_COUNT', message: 'Late arrivals must be at least 1.' };
    }

    const remaining = row.expected_party_size - row.actual_party_size;
    if (remaining <= 0) {
      return {
        ok: false,
        reason: 'FULLY_CHECKED_IN',
        message: 'This party is already fully checked in.',
        checkin: row,
      };
    }
    if (additional > remaining) {
      return {
        ok: false,
        reason: 'TOO_MANY',
        message: `Only ${remaining} remaining for this party.`,
        checkin: row,
        remaining,
      };
    }

    const updated = await client.query(
      `UPDATE checkins
       SET actual_party_size = actual_party_size + $1,
           late_arrivals     = late_arrivals + $1,
           last_updated_at   = NOW()
       WHERE id = $2
       RETURNING *`,
      [additional, row.id]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'add_late_arrivals', 'checkin', $2, $3)`,
      [
        staffId,
        row.id,
        JSON.stringify({
          added: additional,
          previous_actual: row.actual_party_size,
          new_actual: updated.rows[0].actual_party_size,
          expected: row.expected_party_size,
        }),
      ]
    );

    return {
      ok: true,
      checkin: updated.rows[0],
      invitation: {
        id: row.invitation_id,
        name: row.invitee_name,
        expectedPartySize: row.expected_party_size,
        actualPartySize: updated.rows[0].actual_party_size,
        remaining: row.expected_party_size - updated.rows[0].actual_party_size,
      },
    };
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

      (SELECT COALESCE(SUM(expected_party_size),0) FROM checkins) AS expected_attending,
      (SELECT COALESCE(SUM(actual_party_size),0)   FROM checkins) AS actual_attendees,
      (SELECT COALESCE(SUM(expected_party_size - actual_party_size),0)
         FROM checkins) AS no_show_attendees,

      -- NEW: total late arrivals across all check-ins
      (SELECT COALESCE(SUM(late_arrivals),0) FROM checkins) AS late_arrivals,

      (SELECT COUNT(*) FROM email_logs WHERE delivery_status='failed') AS failed_emails
  `);
  return rows[0];
}

module.exports = { validateAndCheckin, addLateArrivals, getSummary };