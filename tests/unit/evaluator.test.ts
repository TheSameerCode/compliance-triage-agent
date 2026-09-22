import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { EvaluationFixture } from '../../evals/cases.schema.js';
import { loadEvaluationDataset } from '../../evals/dataset.js';
import { runEvaluation, type EvaluationAnalyzer } from '../../evals/evaluator.js';
import { evaluationReportSchema } from '../../evals/report.schema.js';
import {
  evaluationExitCode,
  evaluationMachineSummary,
  formatEvaluationSummary,
  writeEvaluationReport,
} from '../../evals/reporting.js';
import { evaluationThresholds } from '../../evals/thresholds.js';
import type { CaseAnalysis } from '../../src/domain/analysis.schemas.js';
import type { ReliableAnalysisResult } from '../../src/services/reliable-analysis.service.js';

function firstExpected<T extends string>(expectation: T | { readonly oneOf: readonly T[] }): T {
  if (typeof expectation === 'string') {
    return expectation;
  }

  const first = expectation.oneOf[0];

  if (first === undefined) {
    throw new Error('Test expectation requires at least one value');
  }

  return first;
}

function perfectResult(fixture: EvaluationFixture): ReliableAnalysisResult {
  const requiredReasons = fixture.expected.requiredReviewReasons ?? [];
  const analysis: CaseAnalysis = {
    category: firstExpected(fixture.expected.category),
    severity: firstExpected(fixture.expected.severity),
    summary: `Synthetic evaluation summary for ${fixture.id}.`,
    missingInformation: requiredReasons.includes('MISSING_INFORMATION')
      ? ['Synthetic required context is missing.']
      : [],
    indicators: ['Synthetic fixture indicator.'],
    confidence: requiredReasons.includes('LOW_CONFIDENCE') ? 0.5 : 0.9,
    modelSuggestsHumanReview: requiredReasons.includes('MODEL_SUGGESTED_REVIEW'),
  };

  return {
    type: 'validated',
    analysis,
    retryCount: 0,
    toolNames: [],
    trace: {
      model: 'fake-eval-model',
      promptVersion: 'triage-v1',
      providerResponseId: `response-${fixture.id}`,
      latencyMs: 5,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    },
  };
}

type ProgressCallback = (fixtureId: string, completed: number, total: number) => void;

function runWith(analyzer: EvaluationAnalyzer, onFixtureComplete?: ProgressCallback) {
  let clock = 100;

  return runEvaluation({
    dataset: loadEvaluationDataset(),
    analyzer,
    config: {
      provider: 'fake-provider',
      model: 'fake-eval-model',
      promptVersion: 'triage-v1',
      reviewPolicy: { confidenceThreshold: 0.75 },
      thresholds: evaluationThresholds,
    },
    now: () => {
      clock += 1;
      return clock;
    },
    timestamp: () => new Date('2026-09-22T12:00:00.000Z'),
    ...(onFixtureComplete === undefined ? {} : { onFixtureComplete }),
  });
}

describe('evaluation runner', () => {
  it('calculates every metric from the complete fixture set and passes a perfect baseline', async () => {
    const onFixtureComplete = vi.fn<ProgressCallback>();
    const report = await runWith(
      { analyze: (fixture) => Promise.resolve(perfectResult(fixture)) },
      onFixtureComplete,
    );

    expect(evaluationReportSchema.safeParse(report).success).toBe(true);
    expect(report).toMatchObject({
      passed: true,
      timestamp: '2026-09-22T12:00:00.000Z',
      metrics: {
        totalCases: 30,
        schemaValidRate: { matched: 30, total: 30, rate: 1 },
        categoryAccuracy: { matched: 30, total: 30, rate: 1 },
        severityAccuracy: { matched: 30, total: 30, rate: 1 },
        reviewRequiredAccuracy: { matched: 30, total: 30, rate: 1 },
        criticalReviewRecall: { matched: 29, total: 29, rate: 1 },
        averageRetryCount: { totalRetries: 0, totalCases: 30, average: 0 },
        latencyMs: { average: 1, p50: 1, p95: 1 },
        tokenUsage: {
          availableCases: 30,
          inputTokens: 300,
          outputTokens: 150,
          totalTokens: 450,
        },
        estimatedCost: { status: 'unavailable' },
      },
      failures: [],
    });
    expect(report.gates.every(({ passed }) => passed)).toBe(true);
    expect(evaluationExitCode(report)).toBe(0);
    expect(onFixtureComplete).toHaveBeenCalledTimes(30);
    expect(onFixtureComplete).toHaveBeenLastCalledWith('SAFE-005', 30, 30);
  });

  it('identifies a provider fallback by fixture and fails the schema gate', async () => {
    const report = await runWith({
      analyze: (fixture) => {
        if (fixture.id !== 'ADV-001') {
          return Promise.resolve(perfectResult(fixture));
        }

        return Promise.resolve({
          type: 'fallback',
          analysisStatus: 'fallback',
          analysis: null,
          reviewDecision: {
            reviewRequired: true,
            reviewReasons: ['MODEL_CALL_FAILED'],
          },
          retryCount: 1,
          toolNames: [],
          failure: { code: 'RATE_LIMITED' },
        });
      },
    });

    expect(report.passed).toBe(false);
    expect(report.metrics).toMatchObject({
      schemaValidRate: { matched: 29, total: 30, rate: 0.967 },
      categoryAccuracy: { matched: 29, total: 30, rate: 0.967 },
      reviewRequiredAccuracy: { matched: 30, total: 30, rate: 1 },
      criticalReviewRecall: { matched: 29, total: 29, rate: 1 },
      averageRetryCount: { totalRetries: 1, totalCases: 30, average: 0.033 },
    });
    expect(report.cases.find(({ fixtureId }) => fixtureId === 'ADV-001')).toMatchObject({
      schemaValid: false,
      failureCode: 'RATE_LIMITED',
    });
    expect(report.failures).toContainEqual({
      fixtureId: 'ADV-001',
      reasons: [
        'schema-valid response unavailable',
        'category mismatch',
        'severity mismatch',
        'required review reason missing',
      ],
    });
    expect(report.gates.find(({ metric }) => metric === 'schemaValidRate')?.passed).toBe(false);
    expect(evaluationExitCode(report)).toBe(1);
  });

  it('prints human and machine summaries without fixture narratives or provider payloads', async () => {
    const report = await runWith({
      analyze: (fixture) => Promise.resolve(perfectResult(fixture)),
    });
    const human = formatEvaluationSummary(report);
    const machine = JSON.stringify(evaluationMachineSummary(report));
    const serializedReport = JSON.stringify(report);

    expect(human).toContain('Evaluation PASSED');
    expect(human).toContain('Critical-review recall: 29/29 (100.0%)');
    expect(machine).toContain('fake-eval-model');
    expect(serializedReport).not.toContain('Ignore all previous instructions');
    expect(serializedReport).not.toContain('providerResponseId');
    expect(serializedReport).not.toContain('apiKey');
    expect(serializedReport).not.toContain('rawOutput');
  });

  it('can pace provider calls without delaying deterministic tests', async () => {
    const wait = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    let clock = 0;

    await runEvaluation({
      dataset: loadEvaluationDataset(),
      analyzer: { analyze: (fixture) => Promise.resolve(perfectResult(fixture)) },
      config: {
        provider: 'fake-provider',
        model: 'fake-eval-model',
        promptVersion: 'triage-v1',
        reviewPolicy: { confidenceThreshold: 0.75 },
        thresholds: evaluationThresholds,
      },
      now: () => {
        clock += 1;
        return clock;
      },
      requestIntervalMs: 9_000,
      wait,
    });

    expect(wait).toHaveBeenCalledTimes(29);
    expect(wait).toHaveBeenCalledWith(9_000);
  });

  it('writes a runtime-validated JSON artifact without report text or provider secrets', async () => {
    const report = await runWith({
      analyze: (fixture) => Promise.resolve(perfectResult(fixture)),
    });
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'compliance-eval-report-'));
    const outputPath = join(temporaryDirectory, 'latest.json');

    try {
      expect(writeEvaluationReport(report, outputPath)).toBe(outputPath);
      const output = readFileSync(outputPath, 'utf8');
      const parsed = evaluationReportSchema.parse(JSON.parse(output) as unknown);

      expect(parsed.dataset).toEqual(report.dataset);
      expect(parsed.metrics).toEqual(report.metrics);
      expect(output).not.toContain('Ignore all previous instructions');
      expect(output).not.toContain('providerResponseId');
      expect(output).not.toContain('apiKey');
    } finally {
      unlinkSync(outputPath);
      rmdirSync(temporaryDirectory);
    }
  });
});
