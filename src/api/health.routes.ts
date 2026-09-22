import { Router } from 'express';

import type { CaseRepository } from '../repositories/case.repository.js';

export function createHealthRouter(caseRepository: CaseRepository): Router {
  const router = Router();

  router.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  router.get('/ready', async (request, response) => {
    try {
      await caseRepository.checkConnection();
      response.status(200).json({ status: 'ready' });
    } catch {
      request.log.warn({ event: 'readiness.failed', errorCode: 'DATABASE_UNAVAILABLE' });
      response.status(503).json({ status: 'not_ready' });
    }
  });

  return router;
}
