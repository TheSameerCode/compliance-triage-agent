import { readFileSync } from 'node:fs';

import { compareEvaluationReports, formatEvaluationComparison } from '../evals/comparison.js';
import { evaluationReportSchema } from '../evals/report.schema.js';

const [baselinePath, candidatePath] = process.argv.slice(2);

if (baselinePath === undefined || candidatePath === undefined) {
  console.error('Usage: npm run eval:compare -- <baseline-report.json> <candidate-report.json>');
  process.exitCode = 1;
} else {
  try {
    const baseline = evaluationReportSchema.parse(
      JSON.parse(readFileSync(baselinePath, 'utf8')) as unknown,
    );
    const candidate = evaluationReportSchema.parse(
      JSON.parse(readFileSync(candidatePath, 'utf8')) as unknown,
    );
    const comparison = compareEvaluationReports(baseline, candidate);

    console.info(formatEvaluationComparison(comparison));
    console.info(`EVAL_COMPARISON_JSON=${JSON.stringify(comparison)}`);

    if (comparison.criticalReviewRecallRegressed) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown comparison failure';
    console.error(`Evaluation comparison failed: ${message}`);
    process.exitCode = 1;
  }
}
