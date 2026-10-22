const express = require('express');
const router = express.Router();
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { scanLimiter } = require('../middleware/rateLimit');
const { validateAndCheckin } = require('../services/checkinService');
const { pool } = require('../config/db');

router.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'views', 'scanner', 'index.html'));
});

// Lookup (does not check in) - for pre-scan preview
router.post('/api/lookup', requireAuth, scanLimiter, async (req, res, next) => {
  try {
    const { qrToken } = req.body || {};
    if (!qrToken) return res.status(400).json({ error: 'qrToken required' });

    const hash = hashToken(qrToken);
    const { rows } = await pool.query(
      `SELECT qc.credential_status, i.invitee_name, i.rsvp_status, i.confirmed_party_size,
              c.checked_in_at,
              c.expected_party_size, c.actual_party_size,
              (c.expected_party_size - c.actual_party_size) AS remaining,
              u.name AS staff_name
       FROM qr_credentials qc
       JOIN invitations i ON i.id = qc.invitation_id
       LEFT JOIN checkins c ON c.invitation_id = i.id
       LEFT JOIN users u ON u.id = c.staff_id
       WHERE qc.qr_reference_hash = $1`,
      [hash]
    );
    if (!rows[0]) return res.json({ valid: false, reason: 'INVALID' });
    const r = rows[0];

    if (r.credential_status !== 'active') return res.json({ valid: false, reason: 'REVOKED' });
    if (r.rsvp_status !== 'accepted') {
      return res.json({ valid: false, reason: 'NOT_ACCEPTED', name: r.invitee_name });
    }
    if (r.checked_in_at) {
      return res.json({
        valid: false,
        reason: 'ALREADY_CHECKED_IN',
        name: r.invitee_name,
        expectedPartySize: r.expected_party_size,
        actualPartySize: r.actual_party_size,
        remaining: r.remaining,
        checkedInAt: r.checked_in_at,
        staffName: r.staff_name,
      });
    }
    res.json({
      valid: true,
      name: r.invitee_name,
      partySize: r.confirmed_party_size,
    });
  } catch (e) { next(e); }
});

// Check in
router.post('/api/checkin', requireAuth, scanLimiter, async (req, res, next) => {
  try {
    const { qrToken, actualPartySize } = req.body || {};
    if (!qrToken) return res.status(400).json({ error: 'qrToken required' });
    const result = await validateAndCheckin(qrToken, req.user.id, actualPartySize);
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/api/late-arrival', requireAuth, scanLimiter, async (req, res, next) => {
  try {
    const { qrToken, additionalCount } = req.body || {};
    if (!qrToken) return res.status(400).json({ error: 'qrToken required' });
    const result = await addLateArrivals(qrToken, req.user.id, additionalCount);
    res.json(result);
  } catch (e) { next(e); }
});

module.exports = router;