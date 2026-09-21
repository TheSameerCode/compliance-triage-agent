import { describe, expect, it } from 'vitest';

import { analysisOutcomeSchema, reviewDecisionSchema } from '../../src/domain/decision.schemas.js';

const validAnalysis = {
  category: 'safeguarding',
  severity: 'high',
  summary: 'A parent reported repeated private contact outside scheduled activities.',
  missingInformation: ['dates of contact'],
  indicators: ['minor involved'],
  confidence: 0.88,
  modelSuggestsHumanReview: true,
} as const;

describe('reviewDecisionSchema', () => {
  it('accepts a review decision with auditable application reasons', () => {
    expect(
      reviewDecisionSchema.parse({
        reviewRequired: true,
        reviewReasons: ['SAFEGUARDING_CATEGORY', 'HIGH_SEVERITY'],
      }),
    ).toEqual({
      reviewRequired: true,
      reviewReasons: ['SAFEGUARDING_CATEGORY', 'HIGH_SEVERITY'],
    });
  });

  it('requires an empty reason list when review is not required', () => {
    expect(
      reviewDecisionSchema.safeParse({
        reviewRequired: false,
        reviewReasons: ['MODEL_SUGGESTED_REVIEW'],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown review reasons', () => {
    expect(
      reviewDecisionSchema.safeParse({
        reviewRequired: true,
        reviewReasons: ['MODEL_APPROVED_AUTOMATION'],
      }).success,
    ).toBe(false);
  });
});

describe('analysisOutcomeSchema', () => {
  it('keeps completed model analysis separate from application policy', () => {
    const outcome = analysisOutcomeSchema.parse({
      analysisStatus: 'completed',
      analysis: validAnalysis,
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: ['SAFEGUARDING_CATEGORY'],
      },
    });

    expect(outcome.analysis).toEqual(validAnalysis);
    expect(outcome.reviewDecision.reviewRequired).toBe(true);
  });

  it('accepts a safe fallback with no model analysis', () => {
    expect(
      analysisOutcomeSchema.parse({
        analysisStatus: 'fallback',
        analysis: null,
        reviewDecision: {
          reviewRequired: true,
          reviewReasons: ['MODEL_OUTPUT_INVALID'],
        },
      }),
    ).toMatchObject({
      analysisStatus: 'fallback',
      analysis: null,
      reviewDecision: { reviewRequired: true },
    });
  });

  it('rejects a fallback that does not require human review', () => {
    expect(
      analysisOutcomeSchema.safeParse({
        analysisStatus: 'fallback',
        analysis: null,
        reviewDecision: { reviewRequired: false, reviewReasons: [] },
      }).success,
    ).toBe(false);
  });

  it('rejects a fallback without an explicit model-failure reason', () => {
    expect(
      analysisOutcomeSchema.safeParse({
        analysisStatus: 'fallback',
        analysis: null,
        reviewDecision: {
          reviewRequired: true,
          reviewReasons: ['LOW_CONFIDENCE'],
        },
      }).success,
    ).toBe(false);
  });
});
