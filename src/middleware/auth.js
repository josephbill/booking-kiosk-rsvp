const { pool } = require('../config/db');

async function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    try {
      const { rows } = await pool.query(
        'SELECT id, name, email, role, active FROM users WHERE id=$1 AND active=true',
        [req.session.userId]
      );
      req.user = rows[0] || null;
    } catch (e) {
      req.user = null;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith('/admin')) return res.redirect('/auth/login');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin };