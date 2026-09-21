import { describe, expect, it } from 'vitest';

import { MAX_CASE_DESCRIPTION_LENGTH, caseInputSchema } from '../../src/domain/case.schemas.js';

describe('caseInputSchema', () => {
  it('accepts and normalizes a valid synthetic report', () => {
    const result = caseInputSchema.parse({
      description: '  A parent reported repeated private messages after training.  ',
      reporterType: 'parent',
      subjectRef: 'subject_demo_01',
    });

    expect(result).toEqual({
      description: 'A parent reported repeated private messages after training.',
      reporterType: 'parent',
      subjectRef: 'subject_demo_01',
    });
  });

  it('rejects a description that is obviously too short', () => {
    expect(() => caseInputSchema.parse({ description: 'Too short' })).toThrow(
      /at least 20 characters/u,
    );
  });

  it('rejects an empty description after trimming whitespace', () => {
    expect(caseInputSchema.safeParse({ description: '   ' }).success).toBe(false);
  });

  it('rejects a description above the explicit maximum', () => {
    expect(() =>
      caseInputSchema.parse({ description: 'a'.repeat(MAX_CASE_DESCRIPTION_LENGTH + 1) }),
    ).toThrow(/at most 12000 characters/u);
  });

  it('rejects unknown request fields', () => {
    expect(() =>
      caseInputSchema.parse({
        description: 'A sufficiently detailed synthetic report for validation.',
        finalDecision: 'close-case',
      }),
    ).toThrow(/Unrecognized key/u);
  });
});
