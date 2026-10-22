const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { verifyPassword } = require('../utils/password');
const { loginLimiter } = require('../middleware/rateLimit');
const path = require('path');

router.get('/login', (req, res) => {
  if (req.user) {
    // If we just logged out, don't bounce back
    if (req.query.loggedout === '1') {
      return res.sendFile(path.join(__dirname, '..', '..', 'views', 'admin', 'login.html'));
    }
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(path.join(__dirname, '..', '..', 'views', 'admin', 'login.html'));
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1 AND active=true', [email]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.userId = user.id;
  res.json({ ok: true, redirect: '/admin/dashboard' });
});

// router.post('/logout', (req, res) => {
//   req.session.destroy(() => res.json({ ok: true }));
// });
// src/routes/auth.js
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[logout] session destroy failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');  // ← important
    res.json({ ok: true });
  });
});

module.exports = router;