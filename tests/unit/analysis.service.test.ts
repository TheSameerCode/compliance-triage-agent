import { describe, expect, it, vi } from 'vitest';

import type { CaseInput } from '../../src/domain/case.schemas.js';
import { ToolExecutionError } from '../../src/errors/application-error.js';
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
import { createPreviousCasesTool } from '../../src/tools/previous-cases.tool.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';

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

    expect(error).toBeInstanceOf(ToolExecutionError);
    expect(error).toMatchObject({ code: 'TOOL_EXECUTION_FAILED', retryable: false });
    expect(JSON.stringify(error)).not.toContain('sensitiveValue');
  });

  it('executes one allow-listed tool call and returns the final structured analysis', async () => {
    const analyze = vi
      .fn<(request: LLMAnalysisRequest) => Promise<LLMResult>>()
      .mockResolvedValueOnce({
        type: 'tool_request',
        model: 'fake-model',
        providerResponseId: 'response-tool-01',
        toolCalls: [
          {
            id: 'call-01',
            name: 'get_previous_cases',
            arguments: { subjectRef: syntheticCase.subjectRef },
          },
        ],
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      })
      .mockResolvedValueOnce({
        type: 'analysis',
        model: 'fake-model',
        providerResponseId: 'response-analysis-01',
        rawOutput: validAnalysis,
        usage: { inputTokens: 130, outputTokens: 40, totalTokens: 170 },
      });
    const getPreviousCaseMetadata = vi.fn().mockResolvedValue({
      previousCaseCount: 2,
      categories: ['other'],
      hasOpenReview: true,
    });
    const toolRegistry = new ToolRegistry(
      [createPreviousCasesTool({ getPreviousCaseMetadata })],
      vi.fn().mockReturnValueOnce(110).mockReturnValueOnce(125),
    );
    const service = new AnalysisService({
      llmClient: { model: 'fake-model', analyze },
      toolRegistry,
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(170),
    });

    const execution = await service.analyze(syntheticCase, { caseId: 'case-current-01' });

    expect(getPreviousCaseMetadata).toHaveBeenCalledWith(
      syntheticCase.subjectRef,
      'case-current-01',
    );
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze.mock.calls[0]?.[0].tools).toHaveLength(1);
    expect(analyze.mock.calls[1]?.[0]).toMatchObject({
      toolContinuation: {
        previousResponseId: 'response-tool-01',
        toolCalls: [{ id: 'call-01', name: 'get_previous_cases' }],
        toolResults: [
          {
            callId: 'call-01',
            name: 'get_previous_cases',
            output: {
              previousCaseCount: 2,
              categories: ['other'],
              hasOpenReview: true,
            },
          },
        ],
      },
    });
    expect(execution).toEqual({
      analysis: validAnalysis,
      trace: {
        model: 'fake-model',
        promptVersion: TRIAGE_PROMPT_VERSION,
        providerResponseId: 'response-analysis-01',
        latencyMs: 70,
        usage: { inputTokens: 230, outputTokens: 50, totalTokens: 280 },
        tools: [{ toolName: 'get_previous_cases', latencyMs: 15 }],
      },
    });
  });

  it('rejects multiple or chained tool calls without autonomous execution', async () => {
    const toolResult: LLMResult = {
      type: 'tool_request',
      model: 'fake-model',
      providerResponseId: 'response-tool',
      toolCalls: [
        {
          id: 'call-01',
          name: 'get_previous_cases',
          arguments: { subjectRef: syntheticCase.subjectRef },
        },
      ],
    };
    const analyze = vi
      .fn<(request: LLMAnalysisRequest) => Promise<LLMResult>>()
      .mockResolvedValueOnce(toolResult)
      .mockResolvedValueOnce({ ...toolResult, providerResponseId: 'response-tool-chained' });
    const getPreviousCaseMetadata = vi.fn().mockResolvedValue({
      previousCaseCount: 0,
      categories: [],
      hasOpenReview: false,
    });
    const service = new AnalysisService({
      llmClient: { model: 'fake-model', analyze },
      toolRegistry: new ToolRegistry([createPreviousCasesTool({ getPreviousCaseMetadata })]),
    });

    await expect(
      service.analyze(syntheticCase, { caseId: 'case-current-01' }),
    ).rejects.toMatchObject({ code: 'TOOL_EXECUTION_FAILED', retryable: false });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(getPreviousCaseMetadata).toHaveBeenCalledTimes(1);
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
