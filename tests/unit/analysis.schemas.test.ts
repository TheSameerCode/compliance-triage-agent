import { describe, expect, it } from 'vitest';

import { caseAnalysisSchema } from '../../src/domain/analysis.schemas.js';

const validAnalysis = {
  category: 'safeguarding',
  severity: 'high',
  summary: 'A parent reported repeated private contact outside scheduled activities.',
  missingInformation: ['dates of contact', 'message records'],
  indicators: ['minor involved', 'private communication'],
  confidence: 0.88,
  modelSuggestsHumanReview: true,
} as const;

describe('caseAnalysisSchema', () => {
  it('accepts a valid structured model analysis', () => {
    expect(caseAnalysisSchema.parse(validAnalysis)).toEqual(validAnalysis);
  });

  it('rejects an unknown category', () => {
    expect(
      caseAnalysisSchema.safeParse({ ...validAnalysis, category: 'disciplinary' }).success,
    ).toBe(false);
  });

  it('rejects an invalid severity', () => {
    expect(caseAnalysisSchema.safeParse({ ...validAnalysis, severity: 'critical' }).success).toBe(
      false,
    );
  });

  it.each([
    ['missingInformation', 'not-an-array'],
    ['indicators', { indicator: 'minor involved' }],
  ])('rejects a non-array %s value', (field, invalidValue) => {
    expect(caseAnalysisSchema.safeParse({ ...validAnalysis, [field]: invalidValue }).success).toBe(
      false,
    );
  });

  it.each([-0.01, 1.01])('rejects confidence outside [0,1]: %s', (confidence) => {
    expect(caseAnalysisSchema.safeParse({ ...validAnalysis, confidence }).success).toBe(false);
  });

  it('does not accept an application-owned reviewRequired field', () => {
    expect(caseAnalysisSchema.safeParse({ ...validAnalysis, reviewRequired: false }).success).toBe(
      false,
    );
  });
});
