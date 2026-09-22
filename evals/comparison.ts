import type { EvaluationReport } from './report.schema.js';

export interface MetricComparison {
  readonly metric: string;
  readonly baseline: number;
  readonly candidate: number;
  readonly delta: number;
  readonly direction: 'improved' | 'regressed' | 'unchanged';
}

export interface EvaluationComparison {
  readonly dataset: EvaluationReport['dataset'];
  readonly baseline: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
  };
  readonly candidate: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
  };
  readonly metrics: readonly MetricComparison[];
  readonly criticalReviewRecallRegressed: boolean;
}

function roundedDelta(candidate: number, baseline: number): number {
  return Math.round((candidate - baseline) * 1_000) / 1_000;
}

export function compareEvaluationReports(
  baseline: EvaluationReport,
  candidate: EvaluationReport,
): EvaluationComparison {
  if (baseline.dataset.hash !== candidate.dataset.hash) {
    throw new Error('Evaluation reports use different dataset hashes and cannot be compared');
  }

  const values = [
    [
      'schemaValidRate',
      baseline.metrics.schemaValidRate.rate,
      candidate.metrics.schemaValidRate.rate,
    ],
    [
      'categoryAccuracy',
      baseline.metrics.categoryAccuracy.rate,
      candidate.metrics.categoryAccuracy.rate,
    ],
    [
      'severityAccuracy',
      baseline.metrics.severityAccuracy.rate,
      candidate.metrics.severityAccuracy.rate,
    ],
    [
      'reviewRequiredAccuracy',
      baseline.metrics.reviewRequiredAccuracy.rate,
      candidate.metrics.reviewRequiredAccuracy.rate,
    ],
    [
      'criticalReviewRecall',
      baseline.metrics.criticalReviewRecall.rate,
      candidate.metrics.criticalReviewRecall.rate,
    ],
  ] as const;
  const metrics = values.map(([metric, baselineValue, candidateValue]) => {
    const delta = roundedDelta(candidateValue, baselineValue);

    return {
      metric,
      baseline: baselineValue,
      candidate: candidateValue,
      delta,
      direction: delta > 0 ? 'improved' : delta < 0 ? 'regressed' : 'unchanged',
    } satisfies MetricComparison;
  });
  const criticalReviewRecall = metrics.find(({ metric }) => metric === 'criticalReviewRecall');

  return {
    dataset: baseline.dataset,
    baseline: {
      provider: baseline.provider,
      model: baseline.model,
      promptVersion: baseline.promptVersion,
    },
    candidate: {
      provider: candidate.provider,
      model: candidate.model,
      promptVersion: candidate.promptVersion,
    },
    metrics,
    criticalReviewRecallRegressed: criticalReviewRecall?.direction === 'regressed',
  };
}

export function formatEvaluationComparison(comparison: EvaluationComparison): string {
  const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;

  return [
    `Dataset: ${comparison.dataset.version} (${comparison.dataset.hash.slice(0, 12)}…)`,
    `Baseline: ${comparison.baseline.provider}/${comparison.baseline.model} (${comparison.baseline.promptVersion})`,
    `Candidate: ${comparison.candidate.provider}/${comparison.candidate.model} (${comparison.candidate.promptVersion})`,
    ...comparison.metrics.map(
      ({ metric, baseline, candidate, delta, direction }) =>
        `${direction.toUpperCase()} ${metric}: ${percentage(baseline)} → ${percentage(candidate)} (${delta >= 0 ? '+' : ''}${percentage(delta)})`,
    ),
    comparison.criticalReviewRecallRegressed
      ? 'CRITICAL: human-review recall regressed'
      : 'Critical human-review recall did not regress',
  ].join('\n');
}
