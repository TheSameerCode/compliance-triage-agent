import { describe, expect, it } from 'vitest';

import { LLMClientError } from '../../src/llm/llm-errors.js';
import { OpenAILLMClient } from '../../src/llm/openai-llm-client.js';
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

function createResponseBody(output: readonly unknown[], status = 'completed') {
  return {
    id: 'resp_test_01',
    object: 'response',
    created_at: 1_790_000_000,
    status,
    error: null,
    incomplete_details: status === 'completed' ? null : { reason: 'max_output_tokens' },
    instructions: null,
    metadata: {},
    model: 'gpt-test-structured',
    output,
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    background: false,
    max_output_tokens: 1_200,
    previous_response_id: null,
    reasoning: null,
    service_tier: 'default',
    store: false,
    text: {},
    truncation: 'disabled',
    usage: {
      input_tokens: 111,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 42,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 153,
    },
  };
}

function outputMessage(content: readonly unknown[]) {
  return {
    id: 'msg_test_01',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content,
  };
}

function jsonFetch(body: unknown, captured?: CapturedRequest, status = 200): typeof fetch {
  return (_input, init) => {
    if (captured !== undefined && typeof init?.body === 'string') {
      captured.body = JSON.parse(init.body) as unknown;
    }

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
}

function createClient(fetchImplementation: typeof fetch): OpenAILLMClient {
  return new OpenAILLMClient({
    apiKey: 'test-key-not-real',
    model: 'gpt-test-structured',
    fetch: fetchImplementation,
  });
}

describe('OpenAILLMClient', () => {
  it('requests non-persisted structured output and maps usage metadata', async () => {
    const captured: CapturedRequest = {};
    const response = createResponseBody([
      outputMessage([
        {
          type: 'output_text',
          text: JSON.stringify(validAnalysis),
          annotations: [],
          logprobs: [],
        },
      ]),
    ]);
    const client = createClient(jsonFetch(response, captured));

    const result = await client.analyze(
      createTriageRequest({
        description: 'A synthetic report describes a spreadsheet sent to the wrong address.',
        subjectRef: 'subject_openai_test_01',
      }),
    );

    expect(result).toEqual({
      type: 'analysis',
      model: 'gpt-test-structured',
      providerResponseId: 'resp_test_01',
      rawOutput: validAnalysis,
      usage: { inputTokens: 111, outputTokens: 42, totalTokens: 153 },
    });
    expect(captured.body).toMatchObject({
      model: 'gpt-test-structured',
      instructions: TRIAGE_SYSTEM_PROMPT,
      store: false,
      parallel_tool_calls: false,
      max_output_tokens: 1_200,
      text: { format: { type: 'json_schema', name: 'case_analysis', strict: true } },
    });
  });

  it('maps a provider function call to a provider-neutral tool request', async () => {
    const captured: CapturedRequest = {};
    const response = createResponseBody([
      {
        type: 'function_call',
        id: 'item_test_01',
        call_id: 'call_test_01',
        name: 'get_previous_cases',
        arguments: '{"subjectRef":"subject_demo_01"}',
        status: 'completed',
      },
    ]);
    const client = createClient(jsonFetch(response, captured));

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
      tools: [
        {
          type: 'function',
          name: 'get_previous_cases',
          strict: true,
        },
      ],
    });
  });

  it('normalizes refusals and incomplete responses', async () => {
    const refusalClient = createClient(
      jsonFetch(
        createResponseBody([
          outputMessage([{ type: 'refusal', refusal: 'Unable to process this request.' }]),
        ]),
      ),
    );
    const incompleteClient = createClient(jsonFetch(createResponseBody([], 'incomplete')));
    const request = createTriageRequest({
      description: 'A synthetic report long enough to exercise provider error mapping.',
    });

    await expect(refusalClient.analyze(request)).rejects.toMatchObject({
      code: 'MODEL_REFUSAL',
      retryable: false,
    });
    await expect(incompleteClient.analyze(request)).rejects.toMatchObject({
      code: 'INCOMPLETE_RESPONSE',
      retryable: true,
    });
  });

  it('normalizes malformed structured output as an invalid provider response', async () => {
    const client = createClient(
      jsonFetch(
        createResponseBody([
          outputMessage([
            { type: 'output_text', text: 'not valid JSON', annotations: [], logprobs: [] },
          ]),
        ]),
      ),
    );

    await expect(
      client.analyze(
        createTriageRequest({
          description: 'A synthetic report long enough to test malformed structured output.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE', retryable: false });
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
