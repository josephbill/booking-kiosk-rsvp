// src/db/updateEvent.js
require('dotenv').config();
const { pool } = require('../config/db');
const env = require('../config/env');

(async () => {
  const result = await pool.query(
    `UPDATE events
     SET name=$1, description=$2, event_date=$3, venue=$4, timezone=$5, updated_at=NOW()
     WHERE id=(SELECT id FROM events ORDER BY id ASC LIMIT 1)
     RETURNING id, name, event_date, venue, timezone`,
    [env.EVENT.NAME, env.EVENT.DESCRIPTION, env.EVENT.DATE, env.EVENT.VENUE, env.EVENT.TIMEZONE]
  );
  if (result.rowCount === 0) {
    console.log('[updateEvent] no event row exists — run npm run seed-admin first');
  } else {
    console.log('[updateEvent] updated:', result.rows[0]);
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });