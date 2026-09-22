import pino, { type DestinationStream, type Logger } from 'pino';

const serviceName = 'compliance-triage-agent';

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: serviceName },
      redact: {
        paths: [
          'description',
          '*.description',
          'caseInput.description',
          '*.caseInput.description',
          'req.body',
          'request.body',
          'req.headers.authorization',
          'req.headers.cookie',
          'apiKey',
          '*.apiKey',
          'prompt',
          '*.prompt',
          'systemPrompt',
          '*.systemPrompt',
          'providerResponse',
          '*.providerResponse',
          'toolArguments',
          '*.toolArguments',
          'toolResults',
          '*.toolResults',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}

export type { Logger };
