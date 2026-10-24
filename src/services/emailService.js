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
  const baseUrl = env.APP_BASE_URL;
  
  // Format the date to match the design (e.g., SUNDAY, 1ST NOVEMBER 2026)
  // We use 'en-GB' to get the day before the month, and append 'ST'/'ND'/'RD'/'TH' manually
  // because JS doesn't have a built-in ordinal formatter.
  const eventDate = new Date(event.event_date);
  const day = eventDate.getDate();
  const suffix = (day % 10 === 1 && day !== 11) ? 'ST' :
                 (day % 10 === 2 && day !== 12) ? 'ND' :
                 (day % 10 === 3 && day !== 13) ? 'RD' : 'TH';
  const monthYear = eventDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
  const weekday = eventDate.toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase();
  const formattedDate = `${weekday}, ${day}${suffix} ${monthYear}`;

  // We use a background image for the card, but since email clients are finicky with background images,
  // we wrap it in a VML (Vector Markup Language) for Outlook, and standard CSS for everyone else.
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Georgia', serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4; padding: 20px;">
        <tr>
          <td align="center">
            
            <!-- Main Invitation Card -->
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #FDF5E6; border: 2px solid #800000; border-radius: 8px; overflow: hidden;">
              
              <!-- Header Logos -->
              <tr>
                <td align="center" style="padding: 30px 20px 10px 20px; background-color: #FDF5E6;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td width="45%" align="center">
                        <img src="${baseUrl}/images/hck-logo.jpeg" alt="Hindu Council of Kenya" width="100" style="display: block; max-width: 100px;">
                      </td>
                      <td width="10%" align="center" style="color: #800000; font-size: 24px; font-weight: bold;">|</td>
                      <td width="45%" align="center">
                        <img src="${baseUrl}/images/oshwal-logo.jpeg" alt="Visa Oshwal Community" width="100" style="display: block; max-width: 100px;">
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- Main Titles -->
              <tr>
                <td align="center" style="padding: 0 20px; background-color: #FDF5E6;">
                  <h1 style="color: #800000; font-size: 22px; margin: 10px 0 5px 0; letter-spacing: 1px; font-weight: bold;">HINDU COUNCIL OF KENYA</h1>
                  <div style="width: 60%; border-top: 1px solid #D4AF37; margin: 10px auto;"></div>
                  
                  <p style="color: #333; font-size: 18px; font-style: italic; margin: 15px 0;">cordially invites</p>
                  
                  <!-- INVITEE NAME -->
                  <h2 style="color: #800000; font-size: 24px; margin: 5px 0; font-weight: bold; font-style: italic; border-bottom: 1px solid #800000; display: inline-block; padding-bottom: 2px;">
                    ${escapeHtml(invitation.invitee_name)}
                  </h2>
                  
                  <p style="color: #333; font-size: 16px; font-style: italic; margin: 15px 0;">to celebrate</p>
                  
                  <!-- EVENT NAME -->
                  <h1 style="color: #800000; font-size: 36px; margin: 10px 0; font-weight: bold; text-transform: uppercase; line-height: 1.1;">
                    ${escapeHtml(event.name)}
                  </h1>
                </td>
              </tr>

              <!-- Slogan / Theme Badge -->
              <tr>
                <td align="center" style="padding: 10px 20px; background-color: #FDF5E6;">
                  <div style="background-color: #800000; color: #D4AF37; padding: 10px 20px; border-radius: 4px; display: inline-block; font-size: 14px; font-weight: bold; letter-spacing: 2px;">
                    SEWA • SAMARPAN • EKTA
                  </div>
                  <p style="color: #800000; font-size: 14px; font-style: italic; margin: 10px 0 20px 0;">Service • Dedication • Unity</p>
                </td>
              </tr>

              <!-- Date & Venue -->
              <tr>
                <td align="center" style="padding: 0 20px; background-color: #FDF5E6;">
                  <p style="color: #800000; font-size: 18px; font-weight: bold; margin: 10px 0;">
                     1st November 2026
                  </p>
                  <p style="color: #800000; font-size: 18px; font-weight: bold; margin: 10px 0 20px 0;">
                    📍 ${escapeHtml(event.venue).toUpperCase()}
                  </p>
                </td>
              </tr>

              <!-- Programme Section -->
              <tr>
                <td align="center" style="padding: 0 40px; background-color: #FDF5E6;">
                  <div style="border-top: 1px solid #D4AF37; border-bottom: 1px solid #D4AF37; padding: 15px 0; margin-bottom: 20px;">
                    <h3 style="color: #800000; font-size: 16px; margin: 0 0 10px 0; text-transform: uppercase;">PROGRAMME</h3>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="left" style="color: #333; font-size: 14px; padding: 5px 0;">10:00 AM – 10:45 AM</td>
                        <td align="right" style="color: #333; font-size: 14px; padding: 5px 0;">Arrival of Guests • Meet & Greet</td>
                      </tr>
                      <tr>
                        <td align="left" style="color: #333; font-size: 14px; padding: 5px 0;">11:00 AM onwards</td>
                        <td align="right" style="color: #333; font-size: 14px; padding: 5px 0;">Diwali Luncheon & Celebrations</td>
                      </tr>
                    </table>
                  </div>

                  <p style="color: #333; font-size: 15px; font-style: italic; margin: 20px 0; line-height: 1.5;">
                    Your gracious presence will honour this occasion as we come together in the spirit of service, dedication and unity.
                  </p>
                </td>
              </tr>

              <!-- RSVP Box -->
              <tr>
                <td align="center" style="padding: 0 30px 30px 30px; background-color: #FDF5E6;">
                  <div style="border: 1px solid #D4AF37; padding: 20px; border-radius: 8px; background-color: #fffcf5;">
                    <p style="color: #800000; font-size: 14px; font-weight: bold; margin: 0 0 10px 0; text-transform: uppercase;">
                      KINDLY RSVP BY THURSDAY, 29TH OCTOBER 2026, BY 5:00 PM
                    </p>
                    <p style="color: #333; font-size: 13px; font-style: italic; margin: 0 0 15px 0;">
                      Please confirm your attendance using the RSVP link below
                    </p>
                    <a href="${rsvpUrl}" style="background-color: #800000; color: #ffffff; padding: 12px 30px; text-decoration: none; font-size: 16px; font-weight: bold; border-radius: 4px; display: inline-block; border: 1px solid #D4AF37;">
                      RSVP NOW
                    </a>
                    <p>or click this link to RSVP : ${rsvpUrl} </p> 
                  </div>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="background-color: #800000; padding: 20px;">
                  <p style="color: #FDF5E6; font-size: 14px; margin: 0 0 5px 0;">With warm regards,</p>
                  <p style="color: #FDF5E6; font-size: 16px; font-weight: bold; margin: 0 0 15px 0;">Hindu Council of Kenya</p>
                  <p style="color: #D4AF37; font-size: 14px; font-style: italic; margin: 0;">
                    Wishing you a Happy & Prosperous Diwali!
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const text = `You are invited to ${event.name}. Date: ${formattedDate}. Venue: ${event.venue}. RSVP: ${rsvpUrl}`;
  
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

  // 3. Set base URL for hosted logos
  const baseUrl = env.APP_BASE_URL;

  // 4. Build the branded HTML email
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Georgia', serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4; padding: 20px;">
        <tr>
          <td align="center">
            <!-- Main Card -->
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #FDF5E6; border: 2px solid #800000; border-radius: 8px; overflow: hidden;">
              
              <!-- Header Logos -->
              <tr>
                <td align="center" style="padding: 30px 20px 10px 20px;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td width="45%" align="center">
                        <img src="${baseUrl}/images/hck-logo.jpeg" alt="Hindu Council of Kenya" width="100" style="display: block; max-width: 100px;">
                      </td>
                      <td width="10%" align="center" style="color: #800000; font-size: 24px;">|</td>
                      <td width="45%" align="center">
                        <img src="${baseUrl}/images/oshwal-logo.jpeg" alt="Visa Oshwal Community" width="100" style="display: block; max-width: 100px;">
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- Event Title -->
              <tr>
                <td align="center" style="padding: 0 20px;">
                  <h1 style="color: #800000; font-size: 22px; margin: 10px 0; letter-spacing: 1px;">HINDU COUNCIL OF KENYA</h1>
                  <div style="width: 50%; border-top: 1px solid #D4AF37; margin: 10px auto;"></div>
                  <h2 style="color: #800000; font-size: 24px; margin: 15px 0; font-weight: bold; text-transform: uppercase;">RSVP CONFIRMED</h2>
                </td>
              </tr>

              <!-- Confirmation Details -->
              <tr>
                <td align="center" style="padding: 10px 30px;">
                  <p style="color: #333; font-size: 16px;">Thank you, <strong>${escapeHtml(invitation.invitee_name)}</strong>.</p>
                  <p style="color: #333; font-size: 16px;">We are delighted to confirm your attendance for a party of <strong>${invitation.confirmed_party_size}</strong>.</p>
                  
                  <div style="margin: 25px 0; padding: 15px; border-top: 1px solid #D4AF37; border-bottom: 1px solid #D4AF37;">
                    <h3 style="color: #800000; font-size: 16px; margin: 0 0 10px 0;">EVENT DETAILS</h3>
                    <p style="color: #333; font-size: 15px; margin: 5px 0;">📅 <strong>${new Date(event.event_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong></p>
                    <p style="color: #333; font-size: 15px; margin: 5px 0;">📍 <strong>${escapeHtml(event.venue)}</strong></p>
                  </div>
                </td>
              </tr>

              <!-- QR Code Section -->
              <tr>
                <td align="center" style="padding: 10px 30px 40px 30px;">
                  <p style="color: #800000; font-size: 16px; font-weight: bold; margin-bottom: 15px;">PLEASE PRESENT THIS QR CODE AT THE ENTRANCE</p>
                  ${qrUrl 
                    ? `<div style="background: #fff; padding: 15px; border-radius: 8px; display: inline-block; border: 2px solid #D4AF37;">
                         <img src="${qrUrl}" alt="Party QR" style="max-width: 250px; width: 100%; height: auto; display: block;" />
                       </div>
                       <p style="font-size: 12px; color: #888; margin-top: 10px;">If the image doesn't display, <a href="${qrUrl}" style="color: #800000;">click here to view</a>.</p>`
                    : `<p style="color: #dc3545; font-weight: bold;">Your QR code could not be generated. Please contact the organizer.</p>`
                  }
                  <p style="color: #666; font-size: 12px; margin-top: 15px;">Do not share this code.</p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="background-color: #800000; padding: 15px;">
                  <p style="color: #FDF5E6; font-size: 12px; margin: 0;">We look forward to welcoming you.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  // 5. Plain text fallback
  const text = `RSVP confirmed for ${event.name}. Party size: ${invitation.confirmed_party_size}. Show the QR code in this email at the entrance.`;

  // 6. Send and log
  try {
    await sendMail({
      to: invitation.invitee_email,
      subject: `RSVP Confirmed – ${event.name}`,
      html, text,
      // No attachments needed; QR is hosted on Cloudinary
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
