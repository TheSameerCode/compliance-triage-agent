import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Logger } from 'pino';

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

declare global {
  // Express uses namespace merging to add request-scoped application fields.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      log: Logger;
      requestId: string;
    }
  }
}

function matchedRoute(request: Request): string {
  const route: unknown = request.route;

  if (typeof route !== 'object' || route === null || !('path' in route)) {
    return 'unmatched';
  }

  return typeof route.path === 'string' ? route.path : 'unmatched';
}

function selectRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;

  return candidate !== undefined && requestIdPattern.test(candidate) ? candidate : randomUUID();
}

export function requestContext(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const requestId = selectRequestId(request.headers['x-request-id']);
    const startedAt = process.hrtime.bigint();

    request.requestId = requestId;
    request.log = logger.child({ requestId });
    response.setHeader('X-Request-Id', requestId);

    response.once('finish', () => {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      request.log.info(
        {
          event: 'request.completed',
          method: request.method,
          route: matchedRoute(request),
          statusCode: response.statusCode,
          latencyMs: Math.round(latencyMs * 100) / 100,
        },
        'request completed',
      );
    });

    next();
  };
}
