import { performance } from 'node:perf_hooks';

import type { EvaluationFixture } from './cases.schema.js';
import type { EvaluationDataset } from './dataset.js';
import {
  evaluationReportSchema,
  type EvaluationCaseResult,
  type EvaluationMetrics,
  type EvaluationReport,
} from './report.schema.js';
import type { EvaluationThresholds } from './thresholds.js';
import type { AnalysisCategory, AnalysisSeverity } from '../src/domain/analysis.schemas.js';
import { evaluateReviewPolicy, type ReviewPolicyConfig } from '../src/domain/review-policy.js';
import { ApplicationError } from '../src/errors/application-error.js';
import type { ReliableAnalysisResult } from '../src/services/reliable-analysis.service.js';

export interface EvaluationAnalyzer {
  analyze(fixture: EvaluationFixture): Promise<ReliableAnalysisResult>;
}

export interface EvaluationRunConfig {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly reviewPolicy: ReviewPolicyConfig;
  readonly thresholds: EvaluationThresholds;
}

export interface EvaluationRunnerOptions {
  readonly dataset: EvaluationDataset;
  readonly analyzer: EvaluationAnalyzer;
  readonly config: EvaluationRunConfig;
  readonly now?: () => number;
  readonly timestamp?: () => Date;
  readonly onFixtureComplete?: (fixtureId: string, completed: number, total: number) => void;
  readonly requestIntervalMs?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

type CategoryExpectation = EvaluationFixture['expected']['category'];
type SeverityExpectation = EvaluationFixture['expected']['severity'];

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function elapsedMilliseconds(start: number, end: number): number {
  return Math.max(0, Math.round(end - start));
}

function matchesCategory(actual: AnalysisCategory | null, expected: CategoryExpectation): boolean {
  if (actual === null) {
    return false;
  }

  return typeof expected === 'string' ? actual === expected : expected.oneOf.includes(actual);
}

function matchesSeverity(actual: AnalysisSeverity | null, expected: SeverityExpectation): boolean {
  if (actual === null) {
    return false;
  }

  return typeof expected === 'string' ? actual === expected : expected.oneOf.includes(actual);
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function ratio(matched: number, total: number) {
  return {
    matched,
    total,
    rate: total === 0 ? 0 : round(matched / total),
  };
}

function metricsFor(
  fixtures: readonly EvaluationFixture[],
  results: readonly EvaluationCaseResult[],
): EvaluationMetrics {
  const totalCases = fixtures.length;
  const criticalIds = new Set(
    fixtures.filter(({ tags }) => tags.includes('critical-review')).map(({ id }) => id),
  );
  const criticalResults = results.filter(({ fixtureId }) => criticalIds.has(fixtureId));
  const totalRetries = results.reduce((sum, result) => sum + result.retryCount, 0);
  const latencies = results.map(({ latencyMs }) => latencyMs);
  const usageResults = results.filter(
    (result) => result.inputTokens !== undefined && result.outputTokens !== undefined,
  );
  const inputTokens = usageResults.reduce((sum, result) => sum + (result.inputTokens ?? 0), 0);
  const outputTokens = usageResults.reduce((sum, result) => sum + (result.outputTokens ?? 0), 0);

  return {
    totalCases,
    schemaValidRate: ratio(results.filter(({ schemaValid }) => schemaValid).length, totalCases),
    categoryAccuracy: ratio(results.filter(({ matches }) => matches.category).length, totalCases),
    severityAccuracy: ratio(results.filter(({ matches }) => matches.severity).length, totalCases),
    reviewRequiredAccuracy: ratio(
      results.filter(({ matches }) => matches.reviewRequired).length,
      totalCases,
    ),
    criticalReviewRecall: ratio(
      criticalResults.filter(({ actual }) => actual.reviewRequired).length,
      criticalResults.length,
    ),
    averageRetryCount: {
      totalRetries,
      totalCases,
      average: totalCases === 0 ? 0 : round(totalRetries / totalCases),
    },
    latencyMs: {
      average:
        latencies.length === 0
          ? 0
          : round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    },
    tokenUsage: {
      availableCases: usageResults.length,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    estimatedCost: {
      status: 'unavailable',
      reason: 'No reviewed provider pricing configuration is available; cost is not estimated.',
    },
  };
}

function failureCodeFor(error: unknown): string {
  return error instanceof ApplicationError && typeof error.code === 'string'
    ? error.code
    : 'EVALUATION_EXECUTION_FAILED';
}

async function evaluateFixture(
  fixture: EvaluationFixture,
  analyzer: EvaluationAnalyzer,
  reviewPolicy: ReviewPolicyConfig,
  now: () => number,
): Promise<EvaluationCaseResult> {
  const startedAt = now();
  let result: ReliableAnalysisResult;

  try {
    result = await analyzer.analyze(fixture);
  } catch (error) {
    const latencyMs = elapsedMilliseconds(startedAt, now());

    return {
      fixtureId: fixture.id,
      schemaValid: false,
      actual: {
        category: null,
        severity: null,
        reviewRequired: true,
        reviewReasons: [],
      },
      matches: {
        category: false,
        severity: false,
        reviewRequired: fixture.expected.reviewRequired,
        requiredReviewReasons: false,
      },
      retryCount: 0,
      latencyMs,
      failureCode: failureCodeFor(error),
      failures: ['analysis execution failed'],
    };
  }

  const schemaValid = result.type === 'validated';
  const analysis = result.type === 'validated' ? result.analysis : null;
  const reviewDecision =
    result.type === 'validated'
      ? evaluateReviewPolicy(result.analysis, reviewPolicy)
      : result.reviewDecision;
  const categoryMatch = matchesCategory(analysis?.category ?? null, fixture.expected.category);
  const severityMatch = matchesSeverity(analysis?.severity ?? null, fixture.expected.severity);
  const reviewRequiredMatch = reviewDecision.reviewRequired === fixture.expected.reviewRequired;
  const requiredReviewReasonsMatch =
    fixture.expected.requiredReviewReasons?.every((reason) =>
      reviewDecision.reviewReasons.includes(reason),
    ) ?? true;
  const failures = [
    ...(schemaValid ? [] : ['schema-valid response unavailable']),
    ...(categoryMatch ? [] : ['category mismatch']),
    ...(severityMatch ? [] : ['severity mismatch']),
    ...(reviewRequiredMatch ? [] : ['review-required mismatch']),
    ...(requiredReviewReasonsMatch ? [] : ['required review reason missing']),
  ];
  const trace = result.type === 'validated' ? result.trace : result.lastTrace;

  return {
    fixtureId: fixture.id,
    schemaValid,
    actual: {
      category: analysis?.category ?? null,
      severity: analysis?.severity ?? null,
      reviewRequired: reviewDecision.reviewRequired,
      reviewReasons: [...reviewDecision.reviewReasons],
    },
    matches: {
      category: categoryMatch,
      severity: severityMatch,
      reviewRequired: reviewRequiredMatch,
      requiredReviewReasons: requiredReviewReasonsMatch,
    },
    retryCount: result.retryCount,
    latencyMs: elapsedMilliseconds(startedAt, now()),
    ...(trace?.usage === undefined
      ? {}
      : {
          inputTokens: trace.usage.inputTokens,
          outputTokens: trace.usage.outputTokens,
        }),
    ...(result.type === 'fallback' ? { failureCode: result.failure.code } : {}),
    failures,
  };
}

export async function runEvaluation({
  dataset,
  analyzer,
  config,
  now = () => performance.now(),
  timestamp = () => new Date(),
  onFixtureComplete,
  requestIntervalMs = 0,
  wait = (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
}: EvaluationRunnerOptions): Promise<EvaluationReport> {
  if (!Number.isInteger(requestIntervalMs) || requestIntervalMs < 0 || requestIntervalMs > 60_000) {
    throw new RangeError('requestIntervalMs must be an integer from 0 through 60000');
  }

  const results: EvaluationCaseResult[] = [];

  for (const fixture of dataset.fixtures) {
    if (results.length > 0 && requestIntervalMs > 0) {
      await wait(requestIntervalMs);
    }

    results.push(await evaluateFixture(fixture, analyzer, config.reviewPolicy, now));
    onFixtureComplete?.(fixture.id, results.length, dataset.fixtures.length);
  }

  const metrics = metricsFor(dataset.fixtures, results);
  const gates = [
    {
      metric: 'schemaValidRate' as const,
      value: metrics.schemaValidRate.rate,
      threshold: config.thresholds.schemaValidRate,
      passed: metrics.schemaValidRate.rate >= config.thresholds.schemaValidRate,
    },
    {
      metric: 'criticalReviewRecall' as const,
      value: metrics.criticalReviewRecall.rate,
      threshold: config.thresholds.criticalReviewRecall,
      passed: metrics.criticalReviewRecall.rate >= config.thresholds.criticalReviewRecall,
    },
    {
      metric: 'reviewRequiredAccuracy' as const,
      value: metrics.reviewRequiredAccuracy.rate,
      threshold: config.thresholds.reviewRequiredAccuracy,
      passed: metrics.reviewRequiredAccuracy.rate >= config.thresholds.reviewRequiredAccuracy,
    },
    {
      metric: 'categoryAccuracy' as const,
      value: metrics.categoryAccuracy.rate,
      threshold: config.thresholds.categoryAccuracy,
      passed: metrics.categoryAccuracy.rate >= config.thresholds.categoryAccuracy,
    },
  ];
  const report = {
    schemaVersion: 'eval-report-v1' as const,
    timestamp: timestamp().toISOString(),
    provider: config.provider,
    model: config.model,
    promptVersion: config.promptVersion,
    dataset: {
      version: dataset.version,
      hash: dataset.hash,
      totalCases: dataset.fixtures.length,
    },
    thresholds: config.thresholds,
    metrics,
    gates,
    passed: gates.every(({ passed }) => passed),
    cases: results,
    failures: results
      .filter(({ failures }) => failures.length > 0)
      .map(({ fixtureId, failures }) => ({ fixtureId, reasons: failures })),
  };

  return evaluationReportSchema.parse(report);
}
