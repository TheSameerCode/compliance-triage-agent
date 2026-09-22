import { describe, expect, it, vi } from 'vitest';

import type { CaseInput } from '../../src/domain/case.schemas.js';
import type {
  LLMAnalysisRequest,
  LLMClient,
  LLMResult,
} from '../../src/llm/llm-client.interface.js';
import { LLMClientError } from '../../src/llm/llm-errors.js';
import { TRIAGE_PROMPT_VERSION } from '../../src/llm/prompts/index.js';
import {
  AnalysisOutputValidationError,
  AnalysisService,
} from '../../src/services/analysis.service.js';

const syntheticCase: CaseInput = {
  description: 'A synthetic report with enough detail for analysis service testing.',
  reporterType: 'member',
  subjectRef: 'subject_test_20',
};

const validAnalysis = {
  category: 'other',
  severity: 'low',
  summary: 'A neutral synthetic summary.',
  missingInformation: ['The date of the event is not supplied.'],
  indicators: ['A concern was reported.'],
  confidence: 0.82,
  modelSuggestsHumanReview: false,
} as const;

function createClient(result: LLMResult): {
  readonly client: LLMClient;
  readonly analyze: ReturnType<typeof vi.fn<(request: LLMAnalysisRequest) => Promise<LLMResult>>>;
} {
  const analyze = vi.fn((_request: LLMAnalysisRequest) => {
    void _request;
    return Promise.resolve(result);
  });

  return {
    client: { model: 'fake-model', analyze },
    analyze,
  };
}

describe('AnalysisService', () => {
  it('converts a normalized provider result into a typed domain analysis and trace', async () => {
    const { client, analyze } = createClient({
      type: 'analysis',
      model: 'fake-model-2026',
      providerResponseId: 'response-01',
      rawOutput: validAnalysis,
      usage: {
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
      },
    });
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(142.6);
    const service = new AnalysisService({ llmClient: client, now });

    const execution = await service.analyze(syntheticCase);

    expect(execution).toEqual({
      analysis: validAnalysis,
      trace: {
        model: 'fake-model-2026',
        promptVersion: TRIAGE_PROMPT_VERSION,
        providerResponseId: 'response-01',
        latencyMs: 43,
        usage: {
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
        },
      },
    });
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        caseInput: syntheticCase,
        promptVersion: TRIAGE_PROMPT_VERSION,
      }),
    );
    expect(execution).not.toHaveProperty('rawOutput');
  });

  it('raises a specific, sanitized validation failure for malformed model output', async () => {
    const { client } = createClient({
      type: 'analysis',
      model: 'fake-model',
      providerResponseId: 'response-invalid',
      rawOutput: {
        ...validAnalysis,
        confidence: 4,
        leakedProviderField: 'must not cross the service boundary',
      },
    });
    const service = new AnalysisService({
      llmClient: client,
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(15),
    });

    const error = await service.analyze(syntheticCase).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnalysisOutputValidationError);
    if (!(error instanceof AnalysisOutputValidationError)) {
      throw new Error('Expected an AnalysisOutputValidationError');
    }

    expect(error.code).toBe('MODEL_OUTPUT_INVALID');
    expect(error.message).toBe('Model output failed application validation');
    expect(error.issues.some((issue) => issue.path === 'confidence')).toBe(true);
    expect(error.issues.some((issue) => issue.path === '$')).toBe(true);
    expect(error.trace).toEqual({
      model: 'fake-model',
      promptVersion: TRIAGE_PROMPT_VERSION,
      providerResponseId: 'response-invalid',
      latencyMs: 5,
    });
    expect(error).not.toHaveProperty('rawOutput');
    expect(JSON.stringify(error)).not.toContain('must not cross the service boundary');
  });

  it('rejects an unexpected tool request without exposing tool arguments', async () => {
    const { client } = createClient({
      type: 'tool_request',
      model: 'fake-model',
      providerResponseId: 'response-tool',
      toolCalls: [
        {
          id: 'call-01',
          name: 'unavailable_tool',
          arguments: { sensitiveValue: 'must not cross the service boundary' },
        },
      ],
    });
    const service = new AnalysisService({
      llmClient: client,
      now: vi.fn().mockReturnValueOnce(25).mockReturnValueOnce(29),
    });

    const error = await service.analyze(syntheticCase).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnalysisOutputValidationError);
    expect(error).toMatchObject({
      code: 'MODEL_OUTPUT_INVALID',
      issues: [{ code: 'unexpected_result_type', path: 'type' }],
    });
    expect(JSON.stringify(error)).not.toContain('sensitiveValue');
  });

  it('preserves normalized client errors for the retry layer', async () => {
    const providerError = new LLMClientError('PROVIDER_UNAVAILABLE', true);
    const client: LLMClient = {
      model: 'fake-model',
      analyze: vi.fn(() => Promise.reject(providerError)),
    };
    const service = new AnalysisService({ llmClient: client, now: () => 100 });

    await expect(service.analyze(syntheticCase)).rejects.toBe(providerError);
  });
});
