const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('request_error', { path: req.path, message: err.message });
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  const safe = status >= 500 ? 'Internal server error' : err.message;
  if (req.path.startsWith('/api') || req.xhr || req.headers.accept?.includes('json')) {
    return res.status(status).json({ error: safe });
  }
  res.status(status).send(`<h1>Error</h1><p>${safe}</p><a href="/">Go home</a>`);
}

module.exports = errorHandler;