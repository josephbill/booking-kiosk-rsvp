const express = require('express');
const router = express.Router();
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { pool } = require('../config/db');
const { getSummary } = require('../services/checkinService');
const { createInvitation, reopenInvitation } = require('../services/invitationService');
const { sendInvitationEmail } = require('../services/emailService');
const { issueQrForInvitation, renderQrDataUrl } = require('../services/qrService');
const { withTransaction } = require('../config/db');
const env = require('../config/env');
const { randomToken } = require('../utils/tokens');
const logger = require('../utils/logger');

// Helper for throttling email sends
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// HTML pages
router.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'views', 'admin', 'dashboard.html'));
});
router.get('/invitations', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'views', 'admin', 'invitations.html'));
});
router.get('/attendance', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'views', 'admin', 'attendance.html'));
});

// API - me
router.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Summary
router.get('/api/summary', requireAuth, async (req, res, next) => {
  try { res.json(await getSummary()); } catch (e) { next(e); }
});

// List invitations
router.get('/api/invitations', requireAuth, async (req, res, next) => {
  try {
    const { q, status } = req.query;
    const params = [];
    const clauses = [];
    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(i.invitee_name ILIKE $${params.length} OR i.invitee_email ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      clauses.push(`i.rsvp_status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT i.id, i.invitee_name, i.invitee_email, i.rsvp_status, i.confirmed_party_size,
              i.max_party_size, i.response_at, i.created_at,
              c.name AS community_name,
              (SELECT checked_in_at FROM checkins WHERE invitation_id=i.id) AS checked_in_at
       FROM invitations i
       LEFT JOIN communities c ON c.id = i.community_id
       ${where}
       ORDER BY i.created_at DESC LIMIT 500`,
      params
    );
    res.json({ invitations: rows });
  } catch (e) { next(e); }
});

// Communities
router.get('/api/communities', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM communities ORDER BY name ASC');
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/api/communities', requireAuth, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || name.trim() === '') return res.status(400).json({ error: 'Name required' });
    const { rows } = await pool.query(
      'INSERT INTO communities (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id, name',
      [name.trim()]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Community already exists' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Create single invitation
router.post('/api/invitations', requireAuth, async (req, res, next) => {
  try {
    const { name, email, maxPartySize, communityId } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });
    const event = await pool.query('SELECT * FROM events ORDER BY id DESC LIMIT 1');
    if (!event.rows[0]) return res.status(400).json({ error: 'No event configured' });

    const inv = await createInvitation({
      eventId: event.rows[0].id,
      name,
      email: email.trim(),
      maxPartySize: parseInt(maxPartySize, 10) || 4,
      communityId: communityId || null,
    });

    sendInvitationEmail(inv, event.rows[0]).catch(() => {});
    res.json({ ok: true, id: inv.id });
  } catch (e) {
    next(e);
  }
});

// CSV import
router.post('/api/invitations/import', requireAuth, async (req, res, next) => {
  try {
    const { rows } = req.body || {};
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });

    const ev = (await pool.query('SELECT * FROM events ORDER BY id DESC LIMIT 1')).rows[0];
    if (!ev) return res.status(400).json({ error: 'No event configured' });

    const results = {
      created: 0,
      failed: 0,
      emailsQueued: 0,
      emailsFailed: 0,
      errors: [],
    };

    // Resolve community names -> ids once (case-insensitive)
    const communityRows = (await pool.query('SELECT id, name FROM communities')).rows;
    const communityMap = new Map(
      communityRows.map(c => [c.name.toLowerCase(), c.id])
    );

    for (const row of rows) {
      try {
        if (!row.name || !row.email) throw new Error('name and email required');

        // Resolve community, or create it if it doesn't exist
        let communityId = null;
        if (row.community && row.community.trim()) {
          const cleanName = row.community.trim();
          const key = cleanName.toLowerCase();

          if (communityMap.has(key)) {
            communityId = communityMap.get(key);
          } else {
            const ins = await pool.query(
              `INSERT INTO communities (name) VALUES ($1)
               ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
               RETURNING id`,
              [cleanName]
            );
            communityId = ins.rows[0].id;
            communityMap.set(key, communityId);
            logger.info('community_auto_created', { name: cleanName, id: communityId });
          }
        }

        // Always create a new invitation, even if the email exists
        const inv = await createInvitation({
          eventId: ev.id,
          name: row.name,
          email: row.email.trim(),
          maxPartySize: parseInt(row.maxPartySize, 10) || 4,
          communityId,
        });

        results.created++;
        results.emailsQueued++;

        try {
          await sendInvitationEmail(inv, ev);
        } catch (e) {
          results.emailsFailed++;
        }

        await sleep(250);

      } catch (e) {
        results.failed++;
        results.errors.push({ row, error: e.message });
      }
    }

    res.json(results);
  } catch (e) { next(e); }
});

// Reopen invitation
router.post('/api/invitations/:id/reopen', requireAuth, async (req, res, next) => {
  try {
    const inv = await reopenInvitation(parseInt(req.params.id, 10), req.user.id);
    res.json({ ok: true, invitation: inv });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Send / resend email
router.post('/api/invitations/:id/email', requireAuth, async (req, res, next) => {
  try {
    const inv = (await pool.query('SELECT * FROM invitations WHERE id=$1', [parseInt(req.params.id, 10)])).rows[0];
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const ev = (await pool.query('SELECT * FROM events WHERE id=$1', [inv.event_id])).rows[0];
    await sendInvitationEmail(inv, ev);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Revoke QR
router.post('/api/invitations/:id/revoke-qr', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(
      `UPDATE qr_credentials SET credential_status='revoked', revoked_at=NOW()
       WHERE invitation_id=$1 AND credential_status='active'`,
      [id]
    );
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id) VALUES ($1,'revoke_qr','invitation',$2)`,
      [req.user.id, id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Regenerate QR
router.post('/api/invitations/:id/regenerate-qr', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await withTransaction(async (client) => {
      const qr = await issueQrForInvitation(client, id);
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id) VALUES ($1,'regenerate_qr','invitation',$2)`,
        [req.user.id, id]
      );
      return qr;
    });
    const dataUrl = await renderQrDataUrl(result.raw);
    res.json({ ok: true, qrDataUrl: dataUrl });
  } catch (e) { next(e); }
});

// Delete invitation
router.delete('/api/invitations/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const result = await withTransaction(async (client) => {
      const found = await client.query('SELECT id FROM invitations WHERE id=$1', [id]);
      if (!found.rows[0]) return { found: false };

      await client.query('DELETE FROM invitations WHERE id=$1', [id]);
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
         VALUES ($1,'delete_invitation','invitation',$2)`,
        [req.user.id, id]
      );
      return { found: true };
    });

    if (!result.found) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
