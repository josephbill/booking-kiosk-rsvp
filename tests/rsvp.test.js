const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { pool, withTransaction } = require('../src/config/db');
const { hashPassword } = require('../src/utils/password');
const { randomToken, hashToken } = require('../src/utils/tokens');
const { toCsv, escapeCsv } = require('../src/services/csvService');
const { issueQrForInvitation } = require('../src/services/qrService');
const {
  respondAccept, respondDecline, reopenInvitation,
} = require('../src/services/invitationService');
const { validateAndCheckin } = require('../src/services/checkinService');

let eventId, staffId;

before(async () => {
  const ev = await pool.query(
    `INSERT INTO events (name, event_date, venue) VALUES ('Test Event', NOW() + interval '1 day', 'Test') RETURNING id`
  );
  eventId = ev.rows[0].id;
  const hash = await hashPassword('test1234');
  const u = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Test Staff',$1,$2,'staff') RETURNING id`,
    [`test${Date.now()}@example.com`, hash]
  );
  staffId = u.rows[0].id;
});

after(async () => {
  await pool.query('DELETE FROM events WHERE id=$1', [eventId]);
  await pool.query('DELETE FROM users WHERE id=$1', [staffId]);
  await pool.end();
});

async function createInv(maxParty = 4) {
  const token = randomToken(32);
  const { rows } = await pool.query(
    `INSERT INTO invitations (event_id, invitee_name, invitee_email, invitation_token, max_party_size)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [eventId, 'Test User', `user${Date.now()}${Math.random()}@example.com`, token, maxParty]
  );
  return rows[0];
}

test('accept valid party size', async () => {
  const inv = await createInv(6);
  const result = await respondAccept(inv.invitation_token, 3);
  assert.equal(result.invitation.rsvp_status, 'accepted');
  assert.equal(result.invitation.confirmed_party_size, 3);
  assert.ok(result.qrToken);
});

test('reject party size below 1', async () => {
  const inv = await createInv(6);
  await assert.rejects(() => respondAccept(inv.invitation_token, 0), /between 1/);
});

test('reject party size above max', async () => {
  const inv = await createInv(2);
  await assert.rejects(() => respondAccept(inv.invitation_token, 5), /between 1/);
});

test('decline invitation', async () => {
  const inv = await createInv();
  const result = await respondDecline(inv.invitation_token);
  assert.equal(result.rsvp_status, 'declined');
});

test('cannot accept after decline', async () => {
  const inv = await createInv();
  await respondDecline(inv.invitation_token);
  await assert.rejects(() => respondAccept(inv.invitation_token, 2), /declined/i);
});

test('cannot accept after accept (duplicate)', async () => {
  const inv = await createInv();
  await respondAccept(inv.invitation_token, 2);
  await assert.rejects(() => respondAccept(inv.invitation_token, 3), /Already responded/);
});

test('admin can reopen declined invitation', async () => {
  const inv = await createInv();
  await respondDecline(inv.invitation_token);
  const reopened = await reopenInvitation(inv.id, staffId);
  assert.equal(reopened.rsvp_status, 'reopened');
});

test('check-in succeeds once and rejects duplicate', async () => {
  const inv = await createInv();
  const { qrToken } = await respondAccept(inv.invitation_token, 2);
  const r1 = await validateAndCheckin(qrToken, staffId);
  assert.equal(r1.ok, true);
  const r2 = await validateAndCheckin(qrToken, staffId);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'ALREADY_CHECKED_IN');
});

test('revoked QR is rejected', async () => {
  const inv = await createInv();
  const { qrToken } = await respondAccept(inv.invitation_token, 1);
  await pool.query(
    `UPDATE qr_credentials SET credential_status='revoked', revoked_at=NOW() WHERE invitation_id=$1`,
    [inv.id]
  );
  const r = await validateAndCheckin(qrToken, staffId);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'REVOKED');
});

test('declined QR is rejected', async () => {
  const inv = await createInv();
  await respondDecline(inv.invitation_token);
  const fakeQr = randomToken(24);
  const r = await validateAndCheckin(fakeQr, staffId);
  assert.equal(r.ok, false);
});

test('CSV escaping handles commas and quotes', () => {
  assert.equal(escapeCsv('a,b'), '"a,b"');
  assert.equal(escapeCsv('a"b'), '"a""b"');
  assert.equal(escapeCsv('=formula'), "'=formula");
  const out = toCsv(['a','b'], [{a:'x,y', b:'z'}]);
  assert.equal(out, 'a,b\r\n"x,y",z');
});

test('expected vs actual attendees totals', async () => {
  const inv1 = await createInv();
  await respondAccept(inv1.invitation_token, 3);
  const inv2 = await createInv();
  await respondAccept(inv2.invitation_token, 2);
  const { rows: sum } = await pool.query(
    `SELECT COALESCE(SUM(confirmed_party_size),0) AS expected
     FROM invitations WHERE event_id=$1 AND rsvp_status='accepted'`,
    [eventId]
  );
  assert.ok(parseInt(sum[0].expected, 10) >= 5);
});