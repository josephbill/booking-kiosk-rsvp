const { pool, withTransaction } = require('../config/db');
const { randomToken } = require('../utils/tokens');
const { issueQrForInvitation } = require('./qrService');
const { sendConfirmationEmail } = require('./emailService');

async function getActiveEvent() {
  const { rows } = await pool.query('SELECT * FROM events ORDER BY id DESC LIMIT 1');
  return rows[0];
}

async function findInvitationByToken(token) {
  const { rows } = await pool.query(
    `SELECT i.*, e.name AS event_name, e.description AS event_description,
            e.event_date, e.venue, e.timezone,
            c.checked_in_at, c.party_size AS checked_in_party_size,
            c.staff_id, u.name AS staff_name
     FROM invitations i
     JOIN events e ON e.id = i.event_id
     LEFT JOIN checkins c ON c.invitation_id = i.id
     LEFT JOIN users u ON u.id = c.staff_id
     WHERE i.invitation_token = $1`,
    [token]
  );
  return rows[0];
}

async function respondAccept(token, partySize) {
  const inv = await findInvitationByToken(token);
  if (!inv) { const e = new Error('Invitation not found'); e.status = 404; throw e; }
  if (inv.rsvp_status === 'accepted') { const e = new Error('Already responded'); e.status = 409; throw e; }
  if (inv.rsvp_status === 'declined') { const e = new Error('Invitation declined; contact organizer'); e.status = 409; throw e; }
  const size = parseInt(partySize, 10);
  if (!Number.isInteger(size) || size < 1 || size > inv.max_party_size) {
    const e = new Error(`Party size must be between 1 and ${inv.max_party_size}`); e.status = 400; throw e;
  }

  return withTransaction(async (client) => {
    // Lock the row to prevent duplicate acceptances
    const { rows } = await client.query(
      `SELECT * FROM invitations WHERE invitation_token=$1 FOR UPDATE`,
      [token]
    );
    const current = rows[0];
    if (!current) { const e = new Error('Invitation not found'); e.status = 404; throw e; }
    if (current.rsvp_status !== 'pending' && current.rsvp_status !== 'reopened') {
      const e = new Error('Invitation is no longer pending'); e.status = 409; throw e;
    }
    const updated = await client.query(
      `UPDATE invitations
       SET rsvp_status='accepted', confirmed_party_size=$1, response_at=NOW(), updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [size, current.id]
    );
    const qr = await issueQrForInvitation(client, current.id);
    // Fire email outside transaction — but record failure if it happens
    setImmediate(() => {
      sendConfirmationEmail({ ...updated.rows[0] }, {
        name: inv.event_name, event_date: inv.event_date, venue: inv.venue,
      }, qr.raw).catch((e) => console.error('[email]', e.message));
    });
    return { invitation: updated.rows[0], qrToken: qr.raw };
  });
}

async function respondDecline(token) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM invitations WHERE invitation_token=$1 FOR UPDATE`,
      [token]
    );
    const inv = rows[0];
    if (!inv) { const e = new Error('Invitation not found'); e.status = 404; throw e; }
    if (inv.rsvp_status === 'accepted' || inv.rsvp_status === 'declined') {
      const e = new Error('Already responded'); e.status = 409; throw e;
    }
    const updated = await client.query(
      `UPDATE invitations
       SET rsvp_status='declined', confirmed_party_size=NULL, response_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [inv.id]
    );
    // Revoke any active QR just in case
    await client.query(
      `UPDATE qr_credentials SET credential_status='revoked', revoked_at=NOW()
       WHERE invitation_id=$1 AND credential_status='active'`,
      [inv.id]
    );
    return updated.rows[0];
  });
}

async function reopenInvitation(invitationId, actorId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE invitations
       SET rsvp_status='reopened', confirmed_party_size=NULL, response_at=NULL, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [invitationId]
    );
    if (!rows[0]) { const e = new Error('Not found'); e.status = 404; throw e; }
    await client.query(
      `UPDATE qr_credentials SET credential_status='revoked', revoked_at=NOW()
       WHERE invitation_id=$1 AND credential_status='active'`,
      [invitationId]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1,'reopen_invitation','invitation',$2,$3)`,
      [actorId, invitationId, JSON.stringify({ at: new Date().toISOString() })]
    );
    return rows[0];
  });
}

async function createInvitation({ eventId, name, email, maxPartySize, communityId }) {
  const token = randomToken(32);
  const { rows } = await pool.query(
    `INSERT INTO invitations (event_id, invitee_name, invitee_email, invitation_token, max_party_size, community_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [eventId, name, email, token, maxPartySize, communityId || null]
  );
  return rows[0];
}

module.exports = {
  getActiveEvent, findInvitationByToken,
  respondAccept, respondDecline, reopenInvitation, createInvitation,
};