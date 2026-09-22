import { loadEnvironment } from '../src/config/env.js';
import { createLLMClient } from '../src/llm/create-llm-client.js';
import { createTriageRequest, TRIAGE_PROMPT_VERSION } from '../src/llm/prompts/index.js';

const environment = loadEnvironment();

if (environment.LLM_API_KEY === undefined || environment.LLM_MODEL === undefined) {
  throw new Error('LLM_API_KEY and LLM_MODEL are required for the live LLM smoke check');
}

const client = createLLMClient({
  provider: environment.LLM_PROVIDER,
  apiKey: environment.LLM_API_KEY,
  model: environment.LLM_MODEL,
});
const result = await client.analyze(
  createTriageRequest({
    description:
      'A synthetic club report states that a membership spreadsheet was shared with an unintended recipient.',
    reporterType: 'synthetic-smoke-test',
    subjectRef: 'subject_llm_smoke_01',
  }),
);

console.info(
  JSON.stringify({
    status: 'ok',
    provider: environment.LLM_PROVIDER,
    resultType: result.type,
    model: result.model,
    promptVersion: TRIAGE_PROMPT_VERSION,
    usage: result.usage,
  }),
);
