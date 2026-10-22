function log(level, msg, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta }));
}
module.exports = {
  info: (m, x) => log('info', m, x),
  warn: (m, x) => log('warn', m, x),
  error: (m, x) => log('error', m, x),
};