import { describe, expect, it } from 'vitest';

import { evaluationFixtureFileSchema, parseEvaluationFixtures } from '../../evals/cases.schema.js';

const exactFixture = {
  id: 'SAFE-001',
  input: {
    description: 'A parent reported repeated private messages after scheduled training.',
    reporterType: 'parent',
    subjectRef: 'subject_demo_01',
  },
  expected: {
    category: 'safeguarding',
    severity: 'high',
    reviewRequired: true,
    requiredReviewReasons: ['SAFEGUARDING_CATEGORY', 'HIGH_SEVERITY'],
  },
  tags: ['baseline', 'critical-review'],
} as const;

describe('evaluationFixtureFileSchema', () => {
  it('accepts an exact golden expectation', () => {
    expect(parseEvaluationFixtures([exactFixture], 'evals/cases.json')).toEqual([exactFixture]);
  });

  it('accepts explicitly encoded ambiguous classifications', () => {
    const ambiguousFixture = {
      ...exactFixture,
      id: 'AMB-001',
      expected: {
        category: { oneOf: ['harassment', 'other'] },
        severity: { oneOf: ['low', 'medium'] },
        reviewRequired: true,
        requiredReviewReasons: ['MISSING_INFORMATION'],
      },
      tags: ['ambiguous', 'critical-review'],
    };

    expect(evaluationFixtureFileSchema.safeParse([ambiguousFixture]).success).toBe(true);
  });

  it('rejects ambiguous expectations with fewer than two choices', () => {
    const invalidFixture = {
      ...exactFixture,
      id: 'AMB-002',
      expected: {
        ...exactFixture.expected,
        category: { oneOf: ['other'] },
      },
    };

    expect(evaluationFixtureFileSchema.safeParse([invalidFixture]).success).toBe(false);
  });

  it('fails with the source, fixture ID, and field location', () => {
    const invalidFixture = {
      ...exactFixture,
      id: 'ADV-001',
      expected: { ...exactFixture.expected, category: 'legal-advice' },
    };

    expect(() => parseEvaluationFixtures([invalidFixture], 'evals/cases.json')).toThrow(
      /evals\/cases\.json.*ADV-001 at expected\.category/u,
    );
  });

  it('rejects duplicate stable fixture IDs', () => {
    expect(() =>
      parseEvaluationFixtures(
        [exactFixture, { ...exactFixture, input: { ...exactFixture.input } }],
        'evals/cases.json',
      ),
    ).toThrow(/SAFE-001 at id: Duplicate fixture ID/u);
  });

  it('rejects deterministic review reasons when review is not required', () => {
    const invalidFixture = {
      ...exactFixture,
      id: 'OTHER-001',
      expected: {
        ...exactFixture.expected,
        reviewRequired: false,
      },
    };

    expect(evaluationFixtureFileSchema.safeParse([invalidFixture]).success).toBe(false);
  });

  it('requires the critical-review tag to match the expected review decision', () => {
    expect(
      evaluationFixtureFileSchema.safeParse([{ ...exactFixture, tags: ['baseline'] }]).success,
    ).toBe(false);
    expect(
      evaluationFixtureFileSchema.safeParse([
        {
          ...exactFixture,
          id: 'OTHER-002',
          expected: { category: 'other', severity: 'low', reviewRequired: false },
          tags: ['baseline', 'critical-review'],
        },
      ]).success,
    ).toBe(false);
  });
});
