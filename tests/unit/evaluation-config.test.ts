import { describe, expect, it } from 'vitest';

import { loadEvaluationEnvironment, resolveEvaluationRequestInterval } from '../../evals/config.js';
import { evaluationThresholds } from '../../evals/thresholds.js';

describe('evaluation configuration', () => {
  it('uses explicit reliability defaults and centralized regression gates', () => {
    expect(loadEvaluationEnvironment({})).toEqual({
      HUMAN_REVIEW_CONFIDENCE_THRESHOLD: 0.75,
      MAX_LLM_RETRIES: 1,
    });
    expect(evaluationThresholds).toEqual({
      schemaValidRate: 1,
      criticalReviewRecall: 1,
      reviewRequiredAccuracy: 0.95,
      categoryAccuracy: 0.85,
    });
  });

  it('validates optional live-provider pacing', () => {
    expect(loadEvaluationEnvironment({ EVAL_REQUEST_INTERVAL_MS: '9000' })).toMatchObject({
      EVAL_REQUEST_INTERVAL_MS: 9_000,
    });
    expect(() => loadEvaluationEnvironment({ EVAL_REQUEST_INTERVAL_MS: '60001' })).toThrow(
      /EVAL_REQUEST_INTERVAL_MS/u,
    );
    expect(resolveEvaluationRequestInterval('groq', undefined)).toBe(9_000);
    expect(resolveEvaluationRequestInterval('openai', undefined)).toBe(0);
    expect(resolveEvaluationRequestInterval('groq', 500)).toBe(500);
  });
});
