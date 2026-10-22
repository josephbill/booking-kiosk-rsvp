// const { sendMail } = require('../config/mailer');
// const { pool } = require('../config/db');
// const env = require('../config/env');
// const { renderQrPng } = require('./qrService');
// const logger = require('../utils/logger');

// // src/services/emailService.js
// async function logEmail(invitationId, type, status, error) {
//   // Silently skip if invitation was deleted mid-flight
//   const exists = await pool.query('SELECT 1 FROM invitations WHERE id=$1', [invitationId]);
//   if (exists.rowCount === 0) return;

//   await pool.query(
//     `INSERT INTO email_logs (invitation_id, email_type, delivery_status, attempt_count, last_error, sent_at)
//      VALUES ($1,$2,$3,1,$4, CASE WHEN $3='sent' THEN NOW() ELSE NULL END)`,
//     [invitationId, type, status, error || null]
//   );
// }

// async function sendInvitationEmail(invitation, event) {
//   const rsvpUrl = `${env.APP_BASE_URL}/rsvp/${invitation.invitation_token}`;
//   const html = `
//     <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
//       <h2 style="color:#0d6efd">You're invited to ${event.name}</h2>
//       <p>Dear ${escapeHtml(invitation.invitee_name)},</p>
//       <p>You are invited to join us. Details:</p>
//       <ul>
//         <li><strong>Date:</strong> ${new Date(event.event_date).toUTCString()}</li>
//         <li><strong>Venue:</strong> ${escapeHtml(event.venue)}</li>
//       </ul>
//       ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}
//       <p style="margin:24px 0">
//         <a href="${rsvpUrl}" style="background:#0d6efd;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">
//           RSVP Now
//         </a>
//       </p>
//       <p>Or copy this link: <a href="${rsvpUrl}">${rsvpUrl}</a></p>
//       <p>We look forward to seeing you!</p>
//     </div>`;
//   const text = `You are invited to ${event.name}. Date: ${event.event_date}. Venue: ${event.venue}. RSVP: ${rsvpUrl}`;
//   try {
//     await sendMail({
//       to: invitation.invitee_email,
//       subject: `Invitation: ${event.name}`,
//       html, text,
//     });
//     await logEmail(invitation.id, 'invitation', 'sent');
//   } catch (err) {
//     logger.error('invitation_email_failed', { id: invitation.id, err: err.message });
//     await logEmail(invitation.id, 'invitation', 'failed', err.message.slice(0, 300));
//   }
// }

// async function sendConfirmationEmail(invitation, event, rawQrToken) {
//   const qrPng = await renderQrPng(rawQrToken);
//   const html = `
//     <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
//       <h2 style="color:#198754">RSVP Confirmed</h2>
//       <p>Dear ${escapeHtml(invitation.invitee_name)},</p>
//       <p>Thank you for confirming. You are attending with a party of <strong>${invitation.confirmed_party_size}</strong>.</p>
//       <ul>
//         <li><strong>Event:</strong> ${event.name}</li>
//         <li><strong>Date:</strong> ${new Date(event.event_date).toUTCString()}</li>
//         <li><strong>Venue:</strong> ${escapeHtml(event.venue)}</li>
//       </ul>
//       <p>Present this QR code at the entrance:</p>
//       <p><img src="cid:partyqr" alt="Party QR" style="max-width:320px"/></p>
//       <p>Do not share this code.</p>
//     </div>`;
//   const text = `RSVP confirmed for ${event.name}. Party size: ${invitation.confirmed_party_size}. Show the attached QR at the entrance.`;
//   try {
//     await sendMail({
//       to: invitation.invitee_email,
//       subject: `RSVP Confirmed – ${event.name}`,
//       html, text,
//       attachments: [{
//         filename: 'party-qr.png',
//         content: qrPng,
//         cid: 'partyqr',
//       }],
//     });
//     await logEmail(invitation.id, 'confirmation', 'sent');
//   } catch (err) {
//     logger.error('confirmation_email_failed', { id: invitation.id, err: err.message });
//     await logEmail(invitation.id, 'confirmation', 'failed', err.message.slice(0, 300));
//   }
// }

// function escapeHtml(s) {
//   return String(s).replace(/[&<>"']/g, (c) => ({
//     '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
//   }[c]));
// }

// module.exports = { sendInvitationEmail, sendConfirmationEmail };


// brevo service 
const { sendMail } = require('../config/mailer');
const { pool } = require('../config/db');
const env = require('../config/env');
const { renderQrPng, uploadQrToCloudinary } = require('./qrService'); // Import the new function
const logger = require('../utils/logger');

async function logEmail(invitationId, type, status, error) {
  const exists = await pool.query('SELECT 1 FROM invitations WHERE id=$1', [invitationId]);
  if (exists.rowCount === 0) return;

  await pool.query(
    `INSERT INTO email_logs (invitation_id, email_type, delivery_status, attempt_count, last_error, sent_at)
     VALUES ($1,$2,$3,1,$4, CASE WHEN $3='sent' THEN NOW() ELSE NULL END)`,
    [invitationId, type, status, error || null]
  );
}

async function sendInvitationEmail(invitation, event) {
  const rsvpUrl = `${env.APP_BASE_URL}/rsvp/${invitation.invitation_token}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
      <h2 style="color:#0d6efd">You're invited to ${escapeHtml(event.name)}</h2>
      <p>Dear ${escapeHtml(invitation.invitee_name)},</p>
      <p>You are invited to join us. Details:</p>
      <ul>
        <li><strong>Date:</strong> ${new Date(event.event_date).toUTCString()}</li>
        <li><strong>Venue:</strong> ${escapeHtml(event.venue)}</li>
      </ul>
      ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}
      <p style="margin:24px 0">
        <a href="${rsvpUrl}" style="background:#0d6efd;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">
          RSVP Now
        </a>
      </p>
      <p>Or copy this link: <a href="${rsvpUrl}">${rsvpUrl}</a></p>
      <p>We look forward to seeing you!</p>
    </div>`;
  const text = `You are invited to ${event.name}. Date: ${event.event_date}. Venue: ${event.venue}. RSVP: ${rsvpUrl}`;
  try {
    await sendMail({
      to: invitation.invitee_email,
      subject: `Invitation: ${event.name}`,
      html, text,
    });
    await logEmail(invitation.id, 'invitation', 'sent');
  } catch (err) {
    logger.error('invitation_email_failed', { id: invitation.id, err: err.message });
    await logEmail(invitation.id, 'invitation', 'failed', err.message.slice(0, 300));
  }
}

async function sendConfirmationEmail(invitation, event, rawQrToken) {
  // 1. Generate QR Buffer
  const qrPng = await renderQrPng(rawQrToken);
  
  // 2. Upload to Cloudinary, get secure URL
  let qrUrl;
  try {
    qrUrl = await uploadQrToCloudinary(qrPng, invitation.invitee_name);
  } catch (err) {
    logger.error('qr_upload_failed', { id: invitation.id, err: err.message });
    // Even if upload fails, don't block email sending; use a fallback text prompt
    qrUrl = null;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
      <h2 style="color:#198754">RSVP Confirmed</h2>
      <p>Dear ${escapeHtml(invitation.invitee_name)},</p>
      <p>Thank you for confirming. You are attending with a party of <strong>${invitation.confirmed_party_size}</strong>.</p>
      <ul>
        <li><strong>Event:</strong> ${escapeHtml(event.name)}</li>
        <li><strong>Date:</strong> ${new Date(event.event_date).toUTCString()}</li>
        <li><strong>Venue:</strong> ${escapeHtml(event.venue)}</li>
      </ul>
      <p>Present this QR code at the entrance:</p>
      ${qrUrl 
        ? `<p><img src="${qrUrl}" alt="Party QR" style="max-width:320px;width:100%;height:auto" /></p>
           <p style="font-size:12px;color:#888">If the image doesn't display, <a href="${qrUrl}">click here to view</a>.</p>`
        : `<p><strong>Your QR code could not be generated.</strong> Please contact the organizer.</p>`
      }
      <p>Do not share this code.</p>
    </div>`;
  const text = `RSVP confirmed for ${event.name}. Party size: ${invitation.confirmed_party_size}. Show the QR code in this email at the entrance.`;

  try {
    await sendMail({
      to: invitation.invitee_email,
      subject: `RSVP Confirmed – ${event.name}`,
      html, text,
      // No attachments needed anymore
    });
    await logEmail(invitation.id, 'confirmation', 'sent');
  } catch (err) {
    logger.error('confirmation_email_failed', { id: invitation.id, err: err.message });
    await logEmail(invitation.id, 'confirmation', 'failed', err.message.slice(0, 300));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = { sendInvitationEmail, sendConfirmationEmail };