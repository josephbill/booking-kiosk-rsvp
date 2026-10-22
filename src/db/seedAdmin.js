require('dotenv').config();
const { pool } = require('../config/db');
const { hashPassword } = require('../utils/password');
const env = require('../config/env');

(async () => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Administrator';
  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD first');
    process.exit(1);
  }
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, active)
     VALUES ($1,$2,$3,'admin',true)
     ON CONFLICT (email) DO UPDATE SET password_hash=$3, name=$1, role='admin', active=true`,
    [name, email, hash]
  );
  // Also seed the event if none exists
  const { rows } = await pool.query('SELECT COUNT(*) FROM events');
  if (parseInt(rows[0].count, 10) === 0) {
    await pool.query(
      `INSERT INTO events (name, description, event_date, venue, timezone)
       VALUES ($1,$2,$3,$4,$5)`,
      [env.EVENT.NAME, env.EVENT.DESCRIPTION, env.EVENT.DATE, env.EVENT.VENUE, env.EVENT.TIMEZONE]
    );
    console.log('[seed] default event created');
  }
  console.log('[seed] admin created/updated:', email);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });