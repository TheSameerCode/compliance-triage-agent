import { describe, expect, it } from 'vitest';

import { GroqLLMClient } from '../../src/llm/groq-llm-client.js';
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
  url?: string;
}

function createResponseBody(message: Readonly<Record<string, unknown>>, finishReason = 'stop') {
  return {
    id: 'chatcmpl_groq_test_01',
    object: 'chat.completion',
    created: 1_790_000_000,
    model: 'openai/gpt-oss-20b',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', refusal: null, ...message },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 111,
      completion_tokens: 42,
      total_tokens: 153,
    },
  };
}

function jsonFetch(body: unknown, captured?: CapturedRequest, status = 200): typeof fetch {
  return async (input, init) => {
    if (captured !== undefined) {
      captured.url = input instanceof Request ? input.url : input.toString();
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

function createClient(fetchImplementation: typeof fetch): GroqLLMClient {
  return new GroqLLMClient({
    apiKey: 'test-key-not-real',
    model: 'openai/gpt-oss-20b',
    fetch: fetchImplementation,
  });
}

describe('GroqLLMClient', () => {
  it('requests strict structured output and maps usage metadata', async () => {
    const captured: CapturedRequest = {};
    const client = createClient(
      jsonFetch(createResponseBody({ content: JSON.stringify(validAnalysis) }), captured),
    );

    const result = await client.analyze(
      createTriageRequest({
        description: 'A synthetic report describes a spreadsheet sent to the wrong address.',
        subjectRef: 'subject_groq_test_01',
      }),
    );

    expect(result).toEqual({
      type: 'analysis',
      model: 'openai/gpt-oss-20b',
      providerResponseId: 'chatcmpl_groq_test_01',
      rawOutput: validAnalysis,
      usage: { inputTokens: 111, outputTokens: 42, totalTokens: 153 },
    });
    expect(captured.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(captured.body).toMatchObject({
      model: 'openai/gpt-oss-20b',
      messages: expect.arrayContaining([
        { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
      ]) as unknown,
      max_completion_tokens: 1_200,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'case_analysis',
          strict: true,
          schema: { type: 'object', additionalProperties: false },
        },
      },
    });
    expect(JSON.stringify(captured.body)).not.toContain('test-key-not-real');
  });

  it('maps a function call and avoids strict structured-output mode when tools are present', async () => {
    const captured: CapturedRequest = {};
    const client = createClient(
      jsonFetch(
        createResponseBody(
          {
            content: null,
            tool_calls: [
              {
                id: 'call_groq_test_01',
                type: 'function',
                function: {
                  name: 'get_previous_cases',
                  arguments: '{"subjectRef":"subject_demo_01"}',
                },
              },
            ],
          },
          'tool_calls',
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
          id: 'call_groq_test_01',
          name: 'get_previous_cases',
          arguments: { subjectRef: 'subject_demo_01' },
        },
      ],
    });
    expect(captured.body).toMatchObject({
      response_format: { type: 'json_object' },
      tool_choice: 'auto',
      tools: [{ type: 'function', function: { name: 'get_previous_cases' } }],
    });
    expect(JSON.stringify(captured.body)).not.toContain('"strict":true');
  });

  it('normalizes incomplete, refused, and malformed responses', async () => {
    const request = createTriageRequest({
      description: 'A synthetic report long enough to exercise invalid response handling.',
    });
    const incompleteClient = createClient(jsonFetch(createResponseBody({ content: '' }, 'length')));
    const refusalClient = createClient(
      jsonFetch(createResponseBody({ content: null, refusal: 'Unable to process.' })),
    );
    const malformedClient = createClient(jsonFetch(createResponseBody({ content: 'not-json' })));

    await expect(incompleteClient.analyze(request)).rejects.toMatchObject({
      code: 'INCOMPLETE_RESPONSE',
      retryable: true,
    });
    await expect(refusalClient.analyze(request)).rejects.toMatchObject({
      code: 'MODEL_REFUSAL',
      retryable: false,
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
            message: 'provider-internal-message',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
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
