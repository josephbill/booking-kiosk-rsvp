const bcrypt = require('bcrypt');

async function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}
async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

module.exports = { hashPassword, verifyPassword };