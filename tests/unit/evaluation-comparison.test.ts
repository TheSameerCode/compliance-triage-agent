import { describe, expect, it } from 'vitest';

import { compareEvaluationReports, formatEvaluationComparison } from '../../evals/comparison.js';
import type { EvaluationReport } from '../../evals/report.schema.js';

function report(
  model: string,
  criticalReviewRecall: number,
  categoryAccuracy: number,
  hash = 'a'.repeat(64),
): EvaluationReport {
  const ratio = (rate: number) => ({ matched: Math.round(rate * 10), total: 10, rate });

  return {
    schemaVersion: 'eval-report-v1',
    timestamp: '2026-09-22T12:00:00.000Z',
    provider: 'fake-provider',
    model,
    promptVersion: 'triage-v1',
    dataset: { version: 'golden-v1', hash, totalCases: 10 },
    thresholds: {
      schemaValidRate: 1,
      criticalReviewRecall: 1,
      reviewRequiredAccuracy: 0.95,
      categoryAccuracy: 0.85,
    },
    metrics: {
      totalCases: 10,
      schemaValidRate: ratio(1),
      categoryAccuracy: ratio(categoryAccuracy),
      severityAccuracy: ratio(0.9),
      reviewRequiredAccuracy: ratio(1),
      criticalReviewRecall: ratio(criticalReviewRecall),
      averageRetryCount: { totalRetries: 0, totalCases: 10, average: 0 },
      latencyMs: { average: 10, p50: 10, p95: 10 },
      tokenUsage: { availableCases: 10, inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      estimatedCost: { status: 'unavailable', reason: 'Not configured.' },
    },
    gates: [
      { metric: 'schemaValidRate', value: 1, threshold: 1, passed: true },
      {
        metric: 'criticalReviewRecall',
        value: criticalReviewRecall,
        threshold: 1,
        passed: criticalReviewRecall >= 1,
      },
      { metric: 'reviewRequiredAccuracy', value: 1, threshold: 0.95, passed: true },
      {
        metric: 'categoryAccuracy',
        value: categoryAccuracy,
        threshold: 0.85,
        passed: categoryAccuracy >= 0.85,
      },
    ],
    passed: criticalReviewRecall >= 1 && categoryAccuracy >= 0.85,
    cases: [
      {
        fixtureId: 'SAFE-001',
        schemaValid: true,
        actual: {
          category: 'safeguarding',
          severity: 'high',
          reviewRequired: true,
          reviewReasons: ['SAFEGUARDING_CATEGORY', 'HIGH_SEVERITY'],
        },
        matches: {
          category: true,
          severity: true,
          reviewRequired: true,
          requiredReviewReasons: true,
        },
        retryCount: 0,
        latencyMs: 10,
        failures: [],
      },
    ],
    failures: [],
  };
}

describe('evaluation report comparison', () => {
  it('highlights improvements and a critical-review recall regression', () => {
    const comparison = compareEvaluationReports(
      report('baseline-model', 1, 0.8),
      report('candidate-model', 0.9, 0.9),
    );

    expect(comparison.metrics).toContainEqual({
      metric: 'categoryAccuracy',
      baseline: 0.8,
      candidate: 0.9,
      delta: 0.1,
      direction: 'improved',
    });
    expect(comparison.metrics).toContainEqual({
      metric: 'criticalReviewRecall',
      baseline: 1,
      candidate: 0.9,
      delta: -0.1,
      direction: 'regressed',
    });
    expect(comparison.criticalReviewRecallRegressed).toBe(true);
    expect(formatEvaluationComparison(comparison)).toContain(
      'CRITICAL: human-review recall regressed',
    );
  });

  it('rejects comparisons across different dataset identities', () => {
    expect(() =>
      compareEvaluationReports(report('one', 1, 1), report('two', 1, 1, 'b'.repeat(64))),
    ).toThrow('different dataset hashes');
  });
});
