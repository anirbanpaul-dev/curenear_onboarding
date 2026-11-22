import pino from 'pino';

const levels = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

/**
 * Structured logging. The level is read from LOG_LEVEL but never requires the
 * full server environment, so route modules can be imported at build time.
 * Personal data is never logged: no provider names, phone numbers, emails,
 * addresses or document contents — only identifiers and status.
 */
const configuredLevel = process.env.LOG_LEVEL;
const level = configuredLevel && levels.has(configuredLevel) ? configuredLevel : 'info';

export const logger = pino({
  level,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'password',
      'passwordHash',
      'token',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    remove: true,
  },
  base: { service: 'curenear-web' },
});
