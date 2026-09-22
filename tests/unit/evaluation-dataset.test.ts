import { describe, expect, it } from 'vitest';

import { loadEvaluationDataset } from '../../evals/dataset.js';

const categoryTags = [
  'safeguarding',
  'harassment',
  'discrimination',
  'financial',
  'privacy',
  'other',
] as const;

const difficultTags = [
  'insufficient-information',
  'conflicting-details',
  'ambiguous-category',
  'prompt-injection',
  'irrelevant-content',
  'long-input',
  'confidence-policy',
  'missing-information',
] as const;

describe('golden evaluation dataset', () => {
  it('loads 30 unique, runtime-validated synthetic fixtures', () => {
    const dataset = loadEvaluationDataset();

    expect(dataset.version).toBe('golden-v1');
    expect(dataset.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(dataset.fixtures).toHaveLength(30);
    expect(new Set(dataset.fixtures.map(({ id }) => id)).size).toBe(30);
    expect(dataset.sources).toEqual([
      'discrimination.json',
      'financial.json',
      'harassment.json',
      'other.json',
      'privacy.json',
      'prompt-injection.json',
      'safeguarding.json',
    ]);
  });

  it('contains five fixtures per category and all severity levels', () => {
    const { fixtures } = loadEvaluationDataset();

    for (const category of categoryTags) {
      expect(fixtures.filter(({ tags }) => tags.includes(category))).toHaveLength(5);
    }

    const representedSeverities = new Set(
      fixtures.flatMap(({ expected }) =>
        typeof expected.severity === 'string' ? [expected.severity] : expected.severity.oneOf,
      ),
    );
    expect(representedSeverities).toEqual(new Set(['low', 'medium', 'high']));
  });

  it('covers every required difficult class and a bounded long input', () => {
    const { fixtures } = loadEvaluationDataset();

    for (const tag of difficultTags) {
      expect(
        fixtures.some(({ tags }) => tags.includes(tag)),
        tag,
      ).toBe(true);
    }

    const longFixture = fixtures.find(({ tags }) => tags.includes('long-input'));
    expect(longFixture?.input.description.length).toBeGreaterThan(700);
    expect(longFixture?.input.description.length).toBeLessThanOrEqual(12_000);
  });

  it('marks the complete expected-review subset for recall calculation', () => {
    const { fixtures } = loadEvaluationDataset();
    const expectedReview = fixtures.filter(({ expected }) => expected.reviewRequired);
    const criticalReview = fixtures.filter(({ tags }) => tags.includes('critical-review'));

    expect(expectedReview).toHaveLength(29);
    expect(criticalReview.map(({ id }) => id).sort()).toEqual(
      expectedReview.map(({ id }) => id).sort(),
    );
  });
});
