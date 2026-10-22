function req(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  APP_BASE_URL: req('APP_BASE_URL', 'http://localhost:3000'),
  SESSION_SECRET: req('SESSION_SECRET', 'dev-only-insecure-secret-please-change-32chars'),
  DATABASE_URL: req('DATABASE_URL', ''),
  EVENT: {
    NAME: process.env.EVENT_NAME || 'Special Event',
    DESCRIPTION: process.env.EVENT_DESCRIPTION || '',
    DATE: process.env.EVENT_DATE || new Date().toISOString(),
    VENUE: process.env.EVENT_VENUE || 'TBD',
    TIMEZONE: process.env.EVENT_TIMEZONE || 'UTC',
  },
  SMTP: {
    HOST: process.env.SMTP_HOST || '',
    PORT: parseInt(process.env.SMTP_PORT || '587', 10),
    SECURE: (process.env.SMTP_SECURE || 'false') === 'true',
    USER: process.env.SMTP_USER || '',
    PASS: process.env.SMTP_PASS || '',
    FROM: process.env.EMAIL_FROM || '',
    FROM_NAME: process.env.EMAIL_FROM_NAME || 'Events',
  },
};