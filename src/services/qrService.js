// src/services/qrService.js
const QRCode = require('qrcode');
const { randomToken, hashToken } = require('../utils/tokens');
const { withTransaction } = require('../config/db');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary (ensure environment variables are read at startup)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function issueQrForInvitation(client, invitationId) {
  // Revoke any existing active credential
  await client.query(
    `UPDATE qr_credentials SET credential_status='revoked', revoked_at=NOW()
     WHERE invitation_id=$1 AND credential_status='active'`,
    [invitationId]
  );
  const raw = randomToken(24);
  const hash = hashToken(raw);
  const { rows } = await client.query(
    `INSERT INTO qr_credentials (invitation_id, qr_reference_hash) VALUES ($1,$2) RETURNING id`,
    [invitationId, hash]
  );
  return { raw, hash, credentialId: rows[0].id };
}

async function renderQrPng(text) {
  return QRCode.toBuffer(text, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
}

async function renderQrDataUrl(text) {
  return QRCode.toDataURL(text, { width: 512, margin: 2 });
}

// New: Upload QR code to Cloudinary and return the secure URL
async function uploadQrToCloudinary(buffer, inviteeName) {
  return new Promise((resolve, reject) => {
    // Use a filename containing the guest's name (remove unsafe characters)
    const sanitizedName = String(inviteeName || 'guest')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);
    const publicId = `rsvp-qr/${sanitizedName}_${Date.now()}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        folder: 'rsvp-qr', // Optional: organize in a folder
        resource_type: 'image',
        format: 'png',
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );

    uploadStream.end(buffer);
  });
}

module.exports = { 
  issueQrForInvitation, 
  renderQrPng, 
  renderQrDataUrl,
  uploadQrToCloudinary 
};