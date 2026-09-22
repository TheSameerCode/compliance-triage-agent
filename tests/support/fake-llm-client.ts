import type { CaseAnalysis } from '../../src/domain/analysis.schemas.js';
import type {
  LLMAnalysisRequest,
  LLMAnalysisResult,
  LLMClient,
  LLMResult,
  LLMToolCall,
  LLMToolRequestResult,
} from '../../src/llm/llm-client.interface.js';
import { LLMClientError, type LLMErrorCode } from '../../src/llm/llm-errors.js';

const defaultValidAnalysis: CaseAnalysis = {
  category: 'other',
  severity: 'low',
  summary: 'A neutral synthetic summary.',
  missingInformation: [],
  indicators: ['A synthetic concern was reported.'],
  confidence: 0.9,
  modelSuggestsHumanReview: false,
};

const defaultInvalidAnalysis = {
  ...defaultValidAnalysis,
  confidence: 2,
};

const defaultToolCall: LLMToolCall = {
  id: 'fake-tool-call-1',
  name: 'get_previous_cases',
  arguments: { subjectRef: 'subject_fake_01' },
};

interface FakeResultMetadata {
  readonly model?: string;
  readonly providerResponseId?: string;
}

export type FakeLLMOutcome =
  | ({ readonly type: 'valid'; readonly analysis?: CaseAnalysis } & FakeResultMetadata)
  | ({ readonly type: 'invalid'; readonly rawOutput?: unknown } & FakeResultMetadata)
  | { readonly type: 'provider_error'; readonly code: LLMErrorCode; readonly retryable: boolean }
  | ({
      readonly type: 'tool_request';
      readonly toolCalls?: readonly LLMToolCall[];
    } & FakeResultMetadata);

export type FakeLLMScenario =
  | { readonly type: 'valid'; readonly analysis?: CaseAnalysis }
  | { readonly type: 'invalid'; readonly rawOutput?: unknown }
  | { readonly type: 'invalid_then_valid'; readonly analysis?: CaseAnalysis }
  | { readonly type: 'repeated_invalid'; readonly rawOutput?: unknown }
  | { readonly type: 'provider_error'; readonly code: LLMErrorCode; readonly retryable: boolean }
  | {
      readonly type: 'tool_request';
      readonly toolCalls?: readonly LLMToolCall[];
      readonly analysis?: CaseAnalysis;
    };

export interface FakeLLMClientOptions {
  readonly scenario: FakeLLMScenario;
  readonly model?: string;
}

function outcomesForScenario(scenario: FakeLLMScenario): readonly FakeLLMOutcome[] {
  switch (scenario.type) {
    case 'valid':
      return [
        {
          type: 'valid',
          ...(scenario.analysis === undefined ? {} : { analysis: scenario.analysis }),
        },
      ];
    case 'invalid':
      return [
        {
          type: 'invalid',
          ...(scenario.rawOutput === undefined ? {} : { rawOutput: scenario.rawOutput }),
        },
      ];
    case 'invalid_then_valid':
      return [
        { type: 'invalid' },
        {
          type: 'valid',
          ...(scenario.analysis === undefined ? {} : { analysis: scenario.analysis }),
        },
      ];
    case 'repeated_invalid':
      return [
        {
          type: 'invalid',
          ...(scenario.rawOutput === undefined ? {} : { rawOutput: scenario.rawOutput }),
        },
        {
          type: 'invalid',
          ...(scenario.rawOutput === undefined ? {} : { rawOutput: scenario.rawOutput }),
        },
      ];
    case 'provider_error':
      return [scenario];
    case 'tool_request':
      return [
        {
          type: 'tool_request',
          ...(scenario.toolCalls === undefined ? {} : { toolCalls: scenario.toolCalls }),
        },
        {
          type: 'valid',
          ...(scenario.analysis === undefined ? {} : { analysis: scenario.analysis }),
        },
      ];
  }
}

/** Deterministic, network-free implementation of the production LLMClient contract. */
export class FakeLLMClient implements LLMClient {
  readonly model: string;
  readonly requests: LLMAnalysisRequest[] = [];
  private readonly outcomes: readonly FakeLLMOutcome[];
  private callIndex = 0;

  constructor({ scenario, model = 'fake-model' }: FakeLLMClientOptions) {
    this.model = model;
    this.outcomes = outcomesForScenario(scenario);
  }

  get callCount(): number {
    return this.callIndex;
  }

  analyze(request: LLMAnalysisRequest): Promise<LLMResult> {
    this.requests.push(request);
    const outcome = this.outcomes[this.callIndex];
    this.callIndex += 1;

    if (outcome === undefined) {
      return Promise.reject(new Error('Fake LLM scenario exhausted'));
    }

    if (outcome.type === 'provider_error') {
      return Promise.reject(new LLMClientError(outcome.code, outcome.retryable));
    }

    const metadata = {
      model: outcome.model ?? this.model,
      providerResponseId: outcome.providerResponseId ?? `fake-response-${this.callIndex}`,
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    } as const;

    if (outcome.type === 'tool_request') {
      const result: LLMToolRequestResult = {
        type: 'tool_request',
        toolCalls: outcome.toolCalls ?? [defaultToolCall],
        ...metadata,
      };
      return Promise.resolve(result);
    }

    const result: LLMAnalysisResult = {
      type: 'analysis',
      rawOutput:
        outcome.type === 'valid'
          ? (outcome.analysis ?? defaultValidAnalysis)
          : (outcome.rawOutput ?? defaultInvalidAnalysis),
      ...metadata,
    };
    return Promise.resolve(result);
  }
}
