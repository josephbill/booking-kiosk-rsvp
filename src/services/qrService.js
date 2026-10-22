const QRCode = require('qrcode');
const { randomToken, hashToken } = require('../utils/tokens');
const { withTransaction } = require('../config/db');

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

module.exports = { issueQrForInvitation, renderQrPng, renderQrDataUrl };