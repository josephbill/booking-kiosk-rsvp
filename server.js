require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const env = require('./src/config/env');
const { pool } = require('./src/config/db');
const errorHandler = require('./src/middleware/error');
const { attachUser } = require('./src/middleware/auth');

const authRoutes = require('./src/routes/auth');
const rsvpRoutes = require('./src/routes/rsvp');
const adminRoutes = require('./src/routes/admin');
const scannerRoutes = require('./src/routes/scanner');
const exportRoutes = require('./src/routes/exports');

const app = express();

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "blob:"],
    },
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

app.use(attachUser);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/views', express.static(path.join(__dirname, 'views')));

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error' });
  }
});

app.use('/auth', authRoutes);
app.use('/rsvp', rsvpRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/scanner', scannerRoutes);
app.use('/admin/exports', exportRoutes);

app.get('/', (req, res) => {
  res.redirect('/admin/login');
});

app.use(errorHandler);

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`[server] listening on port ${env.PORT}`);
});

function shutdown(signal) {
  console.log(`[server] ${signal} received, closing...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;