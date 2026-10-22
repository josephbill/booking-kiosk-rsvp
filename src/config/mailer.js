const nodemailer = require('nodemailer');
const env = require('./env');

let transporter = null;
if (env.SMTP.HOST && env.SMTP.USER) {
  transporter = nodemailer.createTransport({
    host: env.SMTP.HOST,
    port: env.SMTP.PORT,
    secure: env.SMTP.SECURE,
    auth: {
      user: env.SMTP.USER,
      pass: env.SMTP.PASS,
    },
  });
} else {
  console.warn('[mailer] SMTP not configured; emails will be logged only');
}

async function sendMail({ to, subject, html, text, attachments }) {
  if (!transporter) {
    console.log(`[mailer] (no SMTP) to=${to} subject=${subject}`);
    return { messageId: 'logged-only' };
  }
  return transporter.sendMail({
    from: `"${env.SMTP.FROM_NAME}" <${env.SMTP.FROM}>`,
    to, subject, html, text, attachments,
  });
}

module.exports = { sendMail, hasTransport: () => !!transporter };