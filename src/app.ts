import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import type { Logger } from 'pino';

import { createCasesRouter } from './api/cases.routes.js';
import { createHealthRouter } from './api/health.routes.js';
import { HttpError } from './api/http-error.js';
import { requestContext } from './api/request-context.js';
import { DatabaseFailureError, ToolExecutionError } from './errors/application-error.js';
import type { CaseRepository } from './repositories/case.repository.js';
import type { CaseTriageService } from './services/triage.service.js';

export interface AppDependencies {
  readonly caseRepository: CaseRepository;
  readonly logger: Logger;
  readonly triageService?: CaseTriageService;
}

function hasErrorType(error: unknown, type: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: unknown }).type === type
  );
}

export function createApp({ caseRepository, logger, triageService }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestContext(logger));
  app.use(express.json({ limit: '32kb' }));
  app.use(createHealthRouter(caseRepository));
  app.use('/api/cases', createCasesRouter(caseRepository, triageService));

  const notFoundHandler: RequestHandler = (request, _response, next) => {
    next(new HttpError(404, 'ROUTE_NOT_FOUND', `No route for ${request.method}`));
  };
  app.use(notFoundHandler);

  const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
    void _next;
    let httpError: HttpError;

    if (error instanceof HttpError) {
      httpError = error;
    } else if (hasErrorType(error, 'entity.too.large')) {
      httpError = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 32kb');
    } else if (error instanceof SyntaxError && hasErrorType(error, 'entity.parse.failed')) {
      httpError = new HttpError(400, 'INVALID_JSON', 'Request body contains invalid JSON');
    } else if (error instanceof ToolExecutionError) {
      httpError = new HttpError(500, error.code, error.message);
    } else if (error instanceof DatabaseFailureError) {
      httpError = new HttpError(500, error.code, error.message);
    } else {
      httpError = new HttpError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
    }

    request.log[httpError.statusCode >= 500 ? 'error' : 'warn']({
      event: 'request.failed',
      errorCode: httpError.code,
      statusCode: httpError.statusCode,
    });

    response.status(httpError.statusCode).json({
      error: {
        code: httpError.code,
        message: httpError.message,
        requestId: request.requestId,
        ...(httpError.issues === undefined ? {} : { issues: httpError.issues }),
      },
    });
  };
  app.use(errorHandler);

  return app;
}
