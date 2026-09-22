import { Router } from 'express';
import { z } from 'zod';

import type { CaseRepository } from '../repositories/case.repository.js';
import { HttpError } from './http-error.js';

const reviewQueueQuerySchema = z
  .object({
    status: z.literal('required'),
  })
  .strict();

export function createReviewsRouter(caseRepository: CaseRepository): Router {
  const router = Router();

  router.get('/', async (request, response) => {
    const parsed = reviewQueueQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_REVIEW_STATUS', 'Review status must be required');
    }

    const reviews = await caseRepository.findRequiredReviews();

    request.log.info({ event: 'review_queue.listed', resultCount: reviews.length });
    response.status(200).json({ data: reviews });
  });

  return router;
}
