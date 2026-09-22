import { describe, expect, it } from 'vitest';

import { GeminiLLMClient } from '../../src/llm/gemini-llm-client.js';
import { LLMClientError } from '../../src/llm/llm-errors.js';
import { createTriageRequest, TRIAGE_SYSTEM_PROMPT } from '../../src/llm/prompts/index.js';

const validAnalysis = {
  category: 'privacy',
  severity: 'medium',
  summary: 'A synthetic report describes an unintended disclosure.',
  missingInformation: ['Whether access was revoked'],
  indicators: ['Information reached an unintended recipient'],
  confidence: 0.86,
  modelSuggestsHumanReview: true,
} as const;

interface CapturedRequest {
  body?: unknown;
}

function createResponseBody(
  steps: readonly unknown[],
  status = 'completed',
  outputText: string | undefined = JSON.stringify(validAnalysis),
) {
  return {
    id: 'int_test_01',
    object: 'interaction',
    created: '2026-09-22T10:00:00Z',
    updated: '2026-09-22T10:00:01Z',
    status,
    model: 'gemini-test-structured',
    steps,
    ...(outputText === undefined ? {} : { output_text: outputText }),
    usage: {
      total_input_tokens: 111,
      total_output_tokens: 42,
      total_tokens: 153,
    },
  };
}

function jsonFetch(body: unknown, captured?: CapturedRequest, status = 200): typeof fetch {
  return async (input, init) => {
    if (captured !== undefined) {
      const requestBody =
        init?.body === undefined
          ? input instanceof Request
            ? await input.clone().text()
            : undefined
          : await new Response(init.body).text();

      if (requestBody !== undefined && requestBody.length > 0) {
        captured.body = JSON.parse(requestBody) as unknown;
      }
    }

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function createClient(fetchImplementation: typeof fetch): GeminiLLMClient {
  return new GeminiLLMClient({
    apiKey: 'test-key-not-real',
    model: 'gemini-test-structured',
    fetch: fetchImplementation,
  });
}

describe('GeminiLLMClient', () => {
  it('requests non-persisted structured output and maps usage metadata', async () => {
    const captured: CapturedRequest = {};
    const client = createClient(jsonFetch(createResponseBody([]), captured));

    const result = await client.analyze(
      createTriageRequest({
        description: 'A synthetic report describes a spreadsheet sent to the wrong address.',
        subjectRef: 'subject_gemini_test_01',
      }),
    );

    expect(result).toEqual({
      type: 'analysis',
      model: 'gemini-test-structured',
      providerResponseId: 'int_test_01',
      rawOutput: validAnalysis,
      usage: { inputTokens: 111, outputTokens: 42, totalTokens: 153 },
    });
    expect(captured.body).toMatchObject({
      model: 'gemini-test-structured',
      system_instruction: TRIAGE_SYSTEM_PROMPT,
      store: false,
      generation_config: { max_output_tokens: 1_200 },
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: { type: 'object', additionalProperties: false },
      },
    });
    expect(JSON.stringify(captured.body)).not.toContain('test-key-not-real');
  });

  it('maps a provider function call to a provider-neutral tool request', async () => {
    const captured: CapturedRequest = {};
    const client = createClient(
      jsonFetch(
        createResponseBody(
          [
            {
              type: 'function_call',
              id: 'call_test_01',
              name: 'get_previous_cases',
              arguments: { subjectRef: 'subject_demo_01' },
            },
          ],
          'requires_action',
          undefined,
        ),
        captured,
      ),
    );

    const result = await client.analyze(
      createTriageRequest(
        { description: 'A synthetic report requesting relevant prior-case metadata.' },
        [
          {
            name: 'get_previous_cases',
            description: 'Retrieve minimized prior-case metadata.',
            parameters: {
              type: 'object',
              properties: { subjectRef: { type: 'string' } },
              required: ['subjectRef'],
              additionalProperties: false,
            },
          },
        ],
      ),
    );

    expect(result).toMatchObject({
      type: 'tool_request',
      toolCalls: [
        {
          id: 'call_test_01',
          name: 'get_previous_cases',
          arguments: { subjectRef: 'subject_demo_01' },
        },
      ],
    });
    expect(captured.body).toMatchObject({
      tools: [{ type: 'function', name: 'get_previous_cases' }],
    });
  });

  it('normalizes incomplete and malformed structured responses', async () => {
    const request = createTriageRequest({
      description: 'A synthetic report long enough to exercise invalid response handling.',
    });
    const incompleteClient = createClient(
      jsonFetch(createResponseBody([], 'incomplete', undefined)),
    );
    const malformedClient = createClient(
      jsonFetch(createResponseBody([], 'completed', 'not-json')),
    );

    await expect(incompleteClient.analyze(request)).rejects.toMatchObject({
      code: 'INCOMPLETE_RESPONSE',
      retryable: true,
    });
    await expect(malformedClient.analyze(request)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
      retryable: false,
    });
  });

  it('normalizes rate limits without exposing the provider message', async () => {
    const client = createClient(
      jsonFetch(
        {
          error: {
            code: 429,
            message: 'provider-internal-message',
            status: 'RESOURCE_EXHAUSTED',
          },
        },
        undefined,
        429,
      ),
    );

    const error = await client
      .analyze(
        createTriageRequest({
          description: 'A synthetic report long enough to exercise rate-limit handling.',
        }),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LLMClientError);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect((error as Error).message).not.toContain('provider-internal-message');
  });
});
