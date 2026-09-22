import { describe, expect, it, vi } from 'vitest';

import type { CaseAnalysis } from '../../src/domain/analysis.schemas.js';
import { analysisOutcomeSchema } from '../../src/domain/decision.schemas.js';
import { DatabaseFailureError, ToolExecutionError } from '../../src/errors/application-error.js';
import { LLMClientError } from '../../src/llm/llm-errors.js';
import {
  AnalysisOutputValidationError,
  type AnalysisExecution,
  type AnalysisTrace,
} from '../../src/services/analysis.service.js';
import {
  type AnalysisRunner,
  ReliableAnalysisService,
} from '../../src/services/reliable-analysis.service.js';

const syntheticCase = {
  description: 'A synthetic report with enough detail for reliability testing.',
  reporterType: 'member',
  subjectRef: 'subject_reliability_01',
} as const;

const validAnalysis: CaseAnalysis = {
  category: 'other',
  severity: 'low',
  summary: 'A neutral synthetic summary.',
  missingInformation: [],
  indicators: ['A concern was reported.'],
  confidence: 0.9,
  modelSuggestsHumanReview: false,
};

function createTrace(responseId: string): AnalysisTrace {
  return {
    model: 'fake-model',
    promptVersion: 'triage-v1',
    providerResponseId: responseId,
    latencyMs: 5,
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
    },
  };
}

function validExecution(responseId = 'response-valid'): AnalysisExecution {
  return {
    analysis: validAnalysis,
    trace: createTrace(responseId),
  };
}

function invalidOutput(responseId: string): AnalysisOutputValidationError {
  return new AnalysisOutputValidationError(
    [{ code: 'invalid_type', path: 'confidence' }],
    createTrace(responseId),
  );
}

function createRunner(outcomes: readonly (AnalysisExecution | Error)[]): {
  readonly runner: AnalysisRunner;
  readonly analyze: ReturnType<typeof vi.fn<AnalysisRunner['analyze']>>;
} {
  let index = 0;
  const analyze = vi.fn<AnalysisRunner['analyze']>(() => {
    const outcome = outcomes[index];
    index += 1;

    if (outcome === undefined) {
      return Promise.reject(new Error('Fake analysis runner exhausted'));
    }

    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  });

  return { runner: { analyze }, analyze };
}

describe('ReliableAnalysisService', () => {
  it('retries invalid output once and returns a successful typed analysis', async () => {
    const { runner, analyze } = createRunner([invalidOutput('response-invalid'), validExecution()]);
    const service = new ReliableAnalysisService({ analysisRunner: runner });

    const result = await service.analyze(syntheticCase);

    expect(result).toEqual({
      type: 'validated',
      analysis: validAnalysis,
      trace: createTrace('response-valid'),
      retryCount: 1,
    });
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('returns a fail-closed fallback after repeated invalid output', async () => {
    const lastError = invalidOutput('response-invalid-02');
    const { runner, analyze } = createRunner([invalidOutput('response-invalid-01'), lastError]);
    const service = new ReliableAnalysisService({ analysisRunner: runner });

    const result = await service.analyze(syntheticCase);

    expect(result).toEqual({
      type: 'fallback',
      analysisStatus: 'fallback',
      analysis: null,
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: ['MODEL_OUTPUT_INVALID'],
      },
      retryCount: 1,
      failure: { code: 'MODEL_OUTPUT_INVALID' },
      lastTrace: lastError.trace,
    });
    expect(analyze).toHaveBeenCalledTimes(2);
    if (result.type !== 'fallback') {
      throw new Error('Expected a fallback result');
    }

    expect(
      analysisOutcomeSchema.safeParse({
        analysisStatus: result.analysisStatus,
        analysis: result.analysis,
        reviewDecision: result.reviewDecision,
      }).success,
    ).toBe(true);
  });

  it('retries a retryable provider error once', async () => {
    const { runner, analyze } = createRunner([
      new LLMClientError('PROVIDER_UNAVAILABLE', true),
      validExecution(),
    ]);
    const service = new ReliableAnalysisService({ analysisRunner: runner });

    await expect(service.analyze(syntheticCase)).resolves.toMatchObject({
      type: 'validated',
      retryCount: 1,
    });
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('returns a traceable human-review fallback after repeated provider timeouts', async () => {
    const { runner, analyze } = createRunner([
      new LLMClientError('TIMEOUT', true),
      new LLMClientError('TIMEOUT', true),
    ]);
    const service = new ReliableAnalysisService({ analysisRunner: runner });

    const result = await service.analyze(syntheticCase);

    expect(result).toEqual({
      type: 'fallback',
      analysisStatus: 'fallback',
      analysis: null,
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: ['MODEL_CALL_FAILED'],
      },
      retryCount: 1,
      failure: { code: 'TIMEOUT' },
    });
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable provider failure', async () => {
    const { runner, analyze } = createRunner([new LLMClientError('AUTHENTICATION_FAILED', false)]);
    const service = new ReliableAnalysisService({ analysisRunner: runner });

    await expect(service.analyze(syntheticCase)).resolves.toMatchObject({
      type: 'fallback',
      retryCount: 0,
      failure: { code: 'AUTHENTICATION_FAILED' },
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: ['MODEL_CALL_FAILED'],
      },
    });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it.each([new DatabaseFailureError(), new ToolExecutionError()])(
    'does not retry or convert the unrelated $code failure',
    async (error) => {
      const { runner, analyze } = createRunner([error]);
      const service = new ReliableAnalysisService({ analysisRunner: runner });

      await expect(service.analyze(syntheticCase)).rejects.toBe(error);
      expect(analyze).toHaveBeenCalledTimes(1);
    },
  );

  it('does not hide an unexpected programming failure', async () => {
    const error = new Error('Unexpected synthetic failure');
    const { runner, analyze } = createRunner([error]);
    const service = new ReliableAnalysisService({ analysisRunner: runner });

    await expect(service.analyze(syntheticCase)).rejects.toBe(error);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('supports disabling retry explicitly', async () => {
    const { runner, analyze } = createRunner([invalidOutput('response-invalid')]);
    const service = new ReliableAnalysisService({ analysisRunner: runner, maxRetries: 0 });

    await expect(service.analyze(syntheticCase)).resolves.toMatchObject({
      type: 'fallback',
      retryCount: 0,
    });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 1.5, 2])('rejects an unsafe retry limit of %s', (maxRetries) => {
    const { runner } = createRunner([validExecution()]);

    expect(() => new ReliableAnalysisService({ analysisRunner: runner, maxRetries })).toThrow(
      'maxRetries must be an integer from 0 through 1',
    );
  });
});
