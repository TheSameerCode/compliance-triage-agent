import { Router } from 'express';
import { z } from 'zod';

import { caseInputSchema } from '../domain/case.schemas.js';
import type { CaseRepository } from '../repositories/case.repository.js';
import { HttpError } from './http-error.js';

const caseIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);

function validationIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || 'body',
    message: issue.message,
  }));
}

export function createCasesRouter(caseRepository: CaseRepository): Router {
  const router = Router();

  router.post('/', async (request, response) => {
    const parsed = caseInputSchema.safeParse(request.body);

    if (!parsed.success) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        'Request body failed validation',
        validationIssues(parsed.error),
      );
    }

    const createdCase = await caseRepository.create(parsed.data);

    request.log.info({ event: 'case.created', caseId: createdCase.id });
    response.location(`/api/cases/${createdCase.id}`).status(201).json({ data: createdCase });
  });

  router.get('/:id', async (request, response) => {
    const parsedId = caseIdSchema.safeParse(request.params.id);

    if (!parsedId.success) {
      throw new HttpError(400, 'INVALID_CASE_ID', 'Case ID is invalid');
    }

    const caseRecord = await caseRepository.findById(parsedId.data);

    if (caseRecord === null) {
      throw new HttpError(404, 'CASE_NOT_FOUND', 'Case was not found');
    }

    response.status(200).json({ data: caseRecord });
  });

  return router;
}
