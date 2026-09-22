import pino, { type Logger } from 'pino';

const serviceName = 'compliance-triage-agent';

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: serviceName },
    redact: {
      paths: [
        'description',
        '*.description',
        'req.body',
        'request.body',
        'req.headers.authorization',
        'req.headers.cookie',
        'apiKey',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
  });
}

export type { Logger };
