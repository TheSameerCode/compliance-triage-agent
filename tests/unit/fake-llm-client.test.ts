import { describe, expect, it } from 'vitest';

import type { LLMAnalysisRequest, LLMClient } from '../../src/llm/llm-client.interface.js';
import { LLMClientError } from '../../src/llm/llm-errors.js';
import { FakeLLMClient } from '../support/fake-llm-client.js';

const request: LLMAnalysisRequest = {
  caseInput: {
    description: 'A synthetic report with sufficient detail for fake client tests.',
  },
  promptVersion: 'triage-test-v1',
  systemPrompt: 'Synthetic system prompt.',
};

function acceptsProductionContract(client: LLMClient): LLMClient {
  return client;
}

describe('FakeLLMClient', () => {
  it('returns a valid deterministic analysis through the production interface', async () => {
    const client = acceptsProductionContract(new FakeLLMClient({ scenario: { type: 'valid' } }));

    await expect(client.analyze(request)).resolves.toMatchObject({
      type: 'analysis',
      rawOutput: { category: 'other', confidence: 0.9 },
    });
  });

  it('returns configurable invalid output', async () => {
    const rawOutput = { invalid: 'synthetic output' };
    const client = new FakeLLMClient({ scenario: { type: 'invalid', rawOutput } });

    await expect(client.analyze(request)).resolves.toMatchObject({ type: 'analysis', rawOutput });
  });

  it('returns invalid then valid output in a stable order', async () => {
    const client = new FakeLLMClient({ scenario: { type: 'invalid_then_valid' } });

    await expect(client.analyze(request)).resolves.toMatchObject({
      type: 'analysis',
      rawOutput: { confidence: 2 },
    });
    await expect(client.analyze(request)).resolves.toMatchObject({
      type: 'analysis',
      rawOutput: { confidence: 0.9 },
    });
    expect(client.callCount).toBe(2);
  });

  it('returns repeated invalid output and refuses unconfigured extra calls', async () => {
    const client = new FakeLLMClient({ scenario: { type: 'repeated_invalid' } });

    await expect(client.analyze(request)).resolves.toMatchObject({
      rawOutput: { confidence: 2 },
    });
    await expect(client.analyze(request)).resolves.toMatchObject({
      rawOutput: { confidence: 2 },
    });
    await expect(client.analyze(request)).rejects.toThrow('Fake LLM scenario exhausted');
  });

  it('returns a normalized configurable provider error', async () => {
    const client = new FakeLLMClient({
      scenario: { type: 'provider_error', code: 'TIMEOUT', retryable: true },
    });

    const error = await client.analyze(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LLMClientError);
    expect(error).toMatchObject({ code: 'TIMEOUT', retryable: true });
  });

  it('returns a tool request followed by a valid continuation response', async () => {
    const client = new FakeLLMClient({ scenario: { type: 'tool_request' } });

    await expect(client.analyze(request)).resolves.toMatchObject({
      type: 'tool_request',
      toolCalls: [{ name: 'get_previous_cases' }],
    });
    await expect(client.analyze(request)).resolves.toMatchObject({
      type: 'analysis',
      rawOutput: { category: 'other' },
    });
    expect(client.requests).toEqual([request, request]);
  });
});
