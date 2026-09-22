import { loadEvaluationEnvironment, resolveEvaluationRequestInterval } from '../evals/config.js';
import { loadEvaluationDataset } from '../evals/dataset.js';
import { runEvaluation } from '../evals/evaluator.js';
import {
  evaluationMachineSummary,
  evaluationExitCode,
  formatEvaluationSummary,
  writeEvaluationReport,
} from '../evals/reporting.js';
import { evaluationThresholds } from '../evals/thresholds.js';
import { loadLLMEnvironment } from '../src/config/llm-env.js';
import { createLLMClient } from '../src/llm/create-llm-client.js';
import { TRIAGE_PROMPT_VERSION } from '../src/llm/prompts/index.js';
import { AnalysisService } from '../src/services/analysis.service.js';
import { ReliableAnalysisService } from '../src/services/reliable-analysis.service.js';

try {
  const llmEnvironment = loadLLMEnvironment();
  const evaluationEnvironment = loadEvaluationEnvironment();
  const dataset = loadEvaluationDataset();
  const llmClient = createLLMClient({
    provider: llmEnvironment.LLM_PROVIDER,
    model: llmEnvironment.LLM_MODEL,
    apiKey: llmEnvironment.LLM_API_KEY,
  });
  const reliableAnalyzer = new ReliableAnalysisService({
    analysisRunner: new AnalysisService({ llmClient }),
    maxRetries: evaluationEnvironment.MAX_LLM_RETRIES,
  });
  const report = await runEvaluation({
    dataset,
    analyzer: {
      analyze: (fixture) => reliableAnalyzer.analyze(fixture.input),
    },
    config: {
      provider: llmEnvironment.LLM_PROVIDER,
      model: llmEnvironment.LLM_MODEL,
      promptVersion: TRIAGE_PROMPT_VERSION,
      reviewPolicy: {
        confidenceThreshold: evaluationEnvironment.HUMAN_REVIEW_CONFIDENCE_THRESHOLD,
      },
      thresholds: evaluationThresholds,
    },
    onFixtureComplete: (fixtureId, completed, total) => {
      console.error(`[${completed}/${total}] ${fixtureId}`);
    },
    requestIntervalMs: resolveEvaluationRequestInterval(
      llmEnvironment.LLM_PROVIDER,
      evaluationEnvironment.EVAL_REQUEST_INTERVAL_MS,
    ),
  });
  const reportPath = writeEvaluationReport(report);

  console.info(formatEvaluationSummary(report));
  console.info(`Report: ${reportPath}`);
  console.info(`EVAL_RESULT_JSON=${JSON.stringify(evaluationMachineSummary(report))}`);

  process.exitCode = evaluationExitCode(report);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown evaluation failure';
  console.error(`Evaluation could not complete: ${message}`);
  process.exitCode = 1;
}
