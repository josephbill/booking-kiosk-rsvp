// this is for godaddy process - activate on paid tiers on render 
// const nodemailer = require('nodemailer');
// const env = require('./env');

// let transporter = null;
// if (env.SMTP.HOST && env.SMTP.USER) {
//   transporter = nodemailer.createTransport({
//     host: env.SMTP.HOST,
//     port: env.SMTP.PORT,
//     secure: env.SMTP.SECURE,
//     auth: {
//       user: env.SMTP.USER,
//       pass: env.SMTP.PASS,
//     },
//   });
// } else {
//   console.warn('[mailer] SMTP not configured; emails will be logged only');
// }

// async function sendMail({ to, subject, html, text, attachments }) {
//   if (!transporter) {
//     console.log(`[mailer] (no SMTP) to=${to} subject=${subject}`);
//     return { messageId: 'logged-only' };
//   }
//   return transporter.sendMail({
//     from: `"${env.SMTP.FROM_NAME}" <${env.SMTP.FROM}>`,
//     to, subject, html, text, attachments,
//   });
// }

// module.exports = { sendMail, hasTransport: () => !!transporter };

// brevo mailer on free tier 
// src/config/mailer.js
// src/config/mailer.js
// src/config/mailer.js
const env = require('./env');

async function sendMail({ to, cc, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.log(`[mailer] (no BREVO_API_KEY) to=${to} subject=${subject}`);
    return { messageId: 'logged-only' };
  }

  // Build CC array if provided
  const ccList = cc
    ? (Array.isArray(cc) ? cc : [cc]).map(email => ({ email }))
    : undefined;

  const payload = {
    sender: {
      email: env.SMTP.FROM,
      name: env.SMTP.FROM_NAME || 'Events',
    },
    to: [{ email: to }],
    ...(ccList && { cc: ccList }),   // Only include 'cc' if present
    subject,
    htmlContent: html,
    textContent: text,
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Brevo API ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

module.exports = { sendMail, hasTransport: () => !!process.env.BREVO_API_KEY };
