import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluationReportSchema, type EvaluationReport } from './report.schema.js';

const defaultReportPath = fileURLToPath(new URL('./results/latest.json', import.meta.url));

function percentage(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function ratioLine(
  label: string,
  metric: { readonly matched: number; readonly total: number; readonly rate: number },
): string {
  return `${label}: ${metric.matched}/${metric.total} (${percentage(metric.rate)})`;
}

export function formatEvaluationSummary(report: EvaluationReport): string {
  const { metrics } = report;
  const lines = [
    `Evaluation ${report.passed ? 'PASSED' : 'FAILED'}`,
    `Provider/model: ${report.provider}/${report.model}`,
    `Prompt: ${report.promptVersion}`,
    `Dataset: ${report.dataset.version} (${report.dataset.hash.slice(0, 12)}…, ${report.dataset.totalCases} cases)`,
    ratioLine('Schema-valid responses', metrics.schemaValidRate),
    ratioLine('Category accuracy', metrics.categoryAccuracy),
    ratioLine('Severity accuracy', metrics.severityAccuracy),
    ratioLine('Review-required accuracy', metrics.reviewRequiredAccuracy),
    ratioLine('Critical-review recall', metrics.criticalReviewRecall),
    `Average retries: ${metrics.averageRetryCount.average.toFixed(3)} (${metrics.averageRetryCount.totalRetries}/${metrics.averageRetryCount.totalCases})`,
    `Latency ms: avg ${metrics.latencyMs.average.toFixed(1)}, p50 ${metrics.latencyMs.p50}, p95 ${metrics.latencyMs.p95}`,
    `Tokens: ${metrics.tokenUsage.inputTokens} input + ${metrics.tokenUsage.outputTokens} output = ${metrics.tokenUsage.totalTokens} total (${metrics.tokenUsage.availableCases}/${metrics.totalCases} cases reported usage)`,
    `Estimated cost: unavailable (${metrics.estimatedCost.reason})`,
    'Regression gates:',
    ...report.gates.map(
      (gate) =>
        `  ${gate.passed ? 'PASS' : 'FAIL'} ${gate.metric}: ${percentage(gate.value)} (minimum ${percentage(gate.threshold)})`,
    ),
    `Fixture failures: ${report.failures.length}`,
    ...report.failures.map(({ fixtureId, reasons }) => `  ${fixtureId}: ${reasons.join(', ')}`),
  ];

  return lines.join('\n');
}

export function evaluationMachineSummary(report: EvaluationReport) {
  return {
    schemaVersion: report.schemaVersion,
    passed: report.passed,
    provider: report.provider,
    model: report.model,
    promptVersion: report.promptVersion,
    dataset: report.dataset,
    metrics: report.metrics,
    failedGates: report.gates.filter(({ passed }) => !passed).map(({ metric }) => metric),
    failingFixtureIds: report.failures.map(({ fixtureId }) => fixtureId),
  };
}

export function evaluationExitCode(report: EvaluationReport): 0 | 1 {
  return report.passed ? 0 : 1;
}

export function writeEvaluationReport(
  report: EvaluationReport,
  outputPath = defaultReportPath,
): string {
  const validated = evaluationReportSchema.parse(report);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');

  return outputPath;
}
