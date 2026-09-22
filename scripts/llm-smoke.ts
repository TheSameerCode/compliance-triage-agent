import { loadLLMEnvironment } from '../src/config/llm-env.js';
import { createLLMClient } from '../src/llm/create-llm-client.js';
import { LLMClientError } from '../src/llm/llm-errors.js';
import {
  AnalysisOutputValidationError,
  AnalysisService,
} from '../src/services/analysis.service.js';

async function runSmokeCheck(): Promise<void> {
  const environment = loadLLMEnvironment();

  const client = createLLMClient({
    provider: environment.LLM_PROVIDER,
    apiKey: environment.LLM_API_KEY,
    model: environment.LLM_MODEL,
  });
  const analysisService = new AnalysisService({ llmClient: client });
  const execution = await analysisService.analyze({
    description:
      'A synthetic club report states that a membership spreadsheet was shared with an unintended recipient.',
    reporterType: 'synthetic-smoke-test',
    subjectRef: 'subject_llm_smoke_01',
  });

  console.info(
    JSON.stringify({
      status: 'ok',
      provider: environment.LLM_PROVIDER,
      resultType: 'validated_analysis',
      model: execution.trace.model,
      promptVersion: execution.trace.promptVersion,
      latencyMs: execution.trace.latencyMs,
      usage: execution.trace.usage,
    }),
  );
}

try {
  await runSmokeCheck();
} catch (error) {
  const safeError =
    error instanceof LLMClientError
      ? { code: error.code, retryable: error.retryable }
      : error instanceof AnalysisOutputValidationError
        ? { code: error.code }
        : { code: 'SMOKE_CHECK_FAILED', retryable: false };

  console.error(JSON.stringify({ status: 'error', error: safeError }));
  process.exitCode = 1;
}
