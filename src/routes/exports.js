const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { pool } = require('../config/db');
const { toCsv } = require('../services/csvService');

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
}

router.get('/register', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT invitee_name, invitee_email, rsvp_status, confirmed_party_size,
              response_at, created_at
       FROM invitations ORDER BY invitee_name`
    );
    const csv = toCsv(
      ['invitee_name','invitee_email','rsvp_status','confirmed_party_size','response_at','created_at'],
      rows
    );
    sendCsv(res, 'invitation-register.csv', csv);
  } catch (e) { next(e); }
});

router.get('/confirmed', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT invitee_name, invitee_email, confirmed_party_size, response_at
       FROM invitations WHERE rsvp_status='accepted' ORDER BY invitee_name`
    );
    const csv = toCsv(
      ['invitee_name','invitee_email','confirmed_party_size','response_at'], rows);
    sendCsv(res, 'confirmed-parties.csv', csv);
  } catch (e) { next(e); }
});

router.get('/checkins', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.invitee_name, i.invitee_email, c.party_size, c.checked_in_at, u.name AS staff_name
       FROM checkins c
       JOIN invitations i ON i.id=c.invitation_id
       LEFT JOIN users u ON u.id=c.staff_id
       ORDER BY c.checked_in_at`
    );
    const csv = toCsv(
      ['invitee_name','invitee_email','party_size','checked_in_at','staff_name'], rows);
    sendCsv(res, 'checkins.csv', csv);
  } catch (e) { next(e); }
});

router.get('/declined-outstanding', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT invitee_name, invitee_email, rsvp_status, response_at
       FROM invitations WHERE rsvp_status IN ('declined','pending','reopened')
       ORDER BY invitee_name`
    );
    const csv = toCsv(
      ['invitee_name','invitee_email','rsvp_status','response_at'], rows);
    sendCsv(res, 'declined-outstanding.csv', csv);
  } catch (e) { next(e); }
});

router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM invitations) AS total_invitations,
        (SELECT COUNT(*) FROM invitations WHERE rsvp_status='accepted') AS total_accepted,
        (SELECT COUNT(*) FROM invitations WHERE rsvp_status='declined') AS total_declined,
        (SELECT COUNT(*) FROM invitations WHERE rsvp_status='pending') AS total_pending,
        (SELECT COALESCE(SUM(confirmed_party_size),0) FROM invitations WHERE rsvp_status='accepted') AS expected_attendees,
        (SELECT COUNT(*) FROM checkins) AS checked_in_parties,
        (SELECT COALESCE(SUM(party_size),0) FROM checkins) AS actual_attendees
    `);
    const r = rows[0];
    const csv = toCsv(
      ['metric','value'],
      Object.entries(r).map(([metric, value]) => ({ metric, value }))
    );
    sendCsv(res, 'attendance-summary.csv', csv);
  } catch (e) { next(e); }
});

module.exports = router;