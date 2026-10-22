const express = require('express');
const router = express.Router();
const path = require('path');
const { rsvpLimiter } = require('../middleware/rateLimit');
const {
  findInvitationByToken, respondAccept, respondDecline,
} = require('../services/invitationService');

router.get('/:token', (req, res) => {
  // Serve HTML shell; JS fetches data via API
  res.sendFile(path.join(__dirname, '..', '..', 'views', 'rsvp', 'view.html'));
});

router.get('/api/:token', rsvpLimiter, async (req, res, next) => {
  try {
    const inv = await findInvitationByToken(req.params.token);
    if (!inv) return res.status(404).json({ error: 'Invitation not found' });
    res.json({
      inviteeName: inv.invitee_name,
      rsvpStatus: inv.rsvp_status,
      confirmedPartySize: inv.confirmed_party_size,
      maxPartySize: inv.max_party_size,
      event: {
        name: inv.event_name,
        description: inv.event_description,
        date: inv.event_date,
        venue: inv.venue,
        timezone: inv.timezone,
      },
      checkedIn: !!inv.checked_in_at,
    });
  } catch (e) { next(e); }
});

router.post('/api/:token/accept', rsvpLimiter, async (req, res, next) => {
  try {
    const { partySize } = req.body || {};
    const result = await respondAccept(req.params.token, partySize);
    res.json({
      ok: true,
      confirmedPartySize: result.invitation.confirmed_party_size,
      message: 'Thank you for confirming!',
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/api/:token/decline', rsvpLimiter, async (req, res, next) => {
  try {
    await respondDecline(req.params.token);
    res.json({ ok: true, message: 'Your response has been recorded.' });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;