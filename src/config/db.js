const { Pool } = require('pg');
const env = require('./env');
const isRemote = env.DATABASE_URL && !env.DATABASE_URL.includes('localhost') && !env.DATABASE_URL.includes('127.0.0.1');
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isRemote ? { rejectUnauthorized: false } : false,
  max: 10,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err.message);
});

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };