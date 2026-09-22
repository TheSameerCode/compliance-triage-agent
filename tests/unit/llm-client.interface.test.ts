import { describe, expect, it } from 'vitest';

import type {
  LLMAnalysisRequest,
  LLMClient,
  LLMResult,
} from '../../src/llm/llm-client.interface.js';
import { createTriageRequest } from '../../src/llm/prompts/index.js';

class FakeLLMClient implements LLMClient {
  readonly model = 'fake-model';

  analyze(_request: LLMAnalysisRequest): Promise<LLMResult> {
    void _request;
    return Promise.resolve({
      type: 'analysis',
      model: this.model,
      providerResponseId: 'fake-response-01',
      rawOutput: {
        category: 'other',
        severity: 'low',
        summary: 'Synthetic result.',
        missingInformation: [],
        indicators: [],
        confidence: 0.9,
        modelSuggestsHumanReview: false,
      },
    });
  }
}

describe('LLMClient', () => {
  it('can be implemented by a fake without importing a provider SDK', async () => {
    const client: LLMClient = new FakeLLMClient();
    const result = await client.analyze(
      createTriageRequest({
        description: 'A sufficiently detailed synthetic report for the fake client.',
      }),
    );

    expect(result).toMatchObject({
      type: 'analysis',
      model: 'fake-model',
      providerResponseId: 'fake-response-01',
    });
  });
});
