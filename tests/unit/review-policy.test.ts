import { describe, expect, it } from 'vitest';

import type { CaseAnalysis } from '../../src/domain/analysis.schemas.js';
import { analysisOutcomeSchema, reviewDecisionSchema } from '../../src/domain/decision.schemas.js';
import {
  createCompletedAnalysisOutcome,
  evaluateReviewPolicy,
} from '../../src/domain/review-policy.js';

const baselineAnalysis: CaseAnalysis = {
  category: 'other',
  severity: 'low',
  summary: 'A neutral synthetic summary.',
  missingInformation: [],
  indicators: [],
  confidence: 0.9,
  modelSuggestsHumanReview: false,
};

const config = { confidenceThreshold: 0.75 } as const;

describe('evaluateReviewPolicy', () => {
  it('does not require review when no deterministic rule applies', () => {
    expect(evaluateReviewPolicy(baselineAnalysis, config)).toEqual({
      reviewRequired: false,
      reviewReasons: [],
    });
  });

  it.each([
    {
      name: 'safeguarding category',
      analysis: { ...baselineAnalysis, category: 'safeguarding' as const },
      reason: 'SAFEGUARDING_CATEGORY',
    },
    {
      name: 'high severity',
      analysis: { ...baselineAnalysis, severity: 'high' as const },
      reason: 'HIGH_SEVERITY',
    },
    {
      name: 'confidence below the threshold',
      analysis: { ...baselineAnalysis, confidence: 0.74 },
      reason: 'LOW_CONFIDENCE',
    },
    {
      name: 'missing information',
      analysis: { ...baselineAnalysis, missingInformation: ['Event date'] },
      reason: 'MISSING_INFORMATION',
    },
    {
      name: 'model review suggestion',
      analysis: { ...baselineAnalysis, modelSuggestsHumanReview: true },
      reason: 'MODEL_SUGGESTED_REVIEW',
    },
  ])('requires review for $name', ({ analysis, reason }) => {
    expect(evaluateReviewPolicy(analysis, config)).toEqual({
      reviewRequired: true,
      reviewReasons: [reason],
    });
  });

  it('does not classify confidence equal to the threshold as low', () => {
    expect(
      evaluateReviewPolicy({ ...baselineAnalysis, confidence: config.confidenceThreshold }, config),
    ).toEqual({ reviewRequired: false, reviewReasons: [] });
  });

  it('preserves every applicable reason in deterministic order', () => {
    const decision = evaluateReviewPolicy(
      {
        ...baselineAnalysis,
        category: 'safeguarding',
        severity: 'high',
        confidence: 0.2,
        missingInformation: ['Reporter role', 'Event date'],
        modelSuggestsHumanReview: true,
      },
      config,
    );

    expect(decision).toEqual({
      reviewRequired: true,
      reviewReasons: [
        'SAFEGUARDING_CATEGORY',
        'HIGH_SEVERITY',
        'LOW_CONFIDENCE',
        'MISSING_INFORMATION',
        'MODEL_SUGGESTED_REVIEW',
      ],
    });
    expect(reviewDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it('prevents a confident model from bypassing safeguarding and high-severity rules', () => {
    const decision = evaluateReviewPolicy(
      {
        ...baselineAnalysis,
        category: 'safeguarding',
        severity: 'high',
        confidence: 0.99,
        modelSuggestsHumanReview: false,
      },
      config,
    );

    expect(decision).toEqual({
      reviewRequired: true,
      reviewReasons: ['SAFEGUARDING_CATEGORY', 'HIGH_SEVERITY'],
    });
  });

  it.each([-0.01, Number.NaN, Number.POSITIVE_INFINITY, 1.01])(
    'rejects an invalid confidence threshold of %s',
    (confidenceThreshold) => {
      expect(() => evaluateReviewPolicy(baselineAnalysis, { confidenceThreshold })).toThrow(
        'confidenceThreshold must be a finite number from 0 through 1',
      );
    },
  );
});

describe('createCompletedAnalysisOutcome', () => {
  it('combines validated analysis with the application-owned policy decision', () => {
    const outcome = createCompletedAnalysisOutcome(
      { ...baselineAnalysis, severity: 'high' },
      config,
    );

    expect(outcome.reviewDecision).toEqual({
      reviewRequired: true,
      reviewReasons: ['HIGH_SEVERITY'],
    });
    expect(analysisOutcomeSchema.safeParse(outcome).success).toBe(true);
  });
});
