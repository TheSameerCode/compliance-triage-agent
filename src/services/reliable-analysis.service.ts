import type { CaseAnalysis } from '../domain/analysis.schemas.js';
import type { CaseInput } from '../domain/case.schemas.js';
import type { ReviewDecision } from '../domain/decision.schemas.js';
import { ApplicationError } from '../errors/application-error.js';
import type { LLMErrorCode } from '../llm/llm-errors.js';
import { ToolRoundBudget } from '../tools/tool-registry.js';
import {
  AnalysisOutputValidationError,
  type AnalysisContext,
  type AnalysisExecution,
  type AnalysisTrace,
} from './analysis.service.js';

export type ModelAnalysisFailureCode = LLMErrorCode | 'MODEL_OUTPUT_INVALID';

export interface AnalysisRunner {
  analyze(caseInput: CaseInput, context?: AnalysisContext): Promise<AnalysisExecution>;
}

export interface ValidatedAnalysisResult {
  readonly type: 'validated';
  readonly analysis: CaseAnalysis;
  readonly trace: AnalysisTrace;
  readonly retryCount: number;
  readonly toolNames: readonly string[];
}

export interface FallbackAnalysisResult {
  readonly type: 'fallback';
  readonly analysisStatus: 'fallback';
  readonly analysis: null;
  readonly reviewDecision: ReviewDecision & { readonly reviewRequired: true };
  readonly retryCount: number;
  readonly toolNames: readonly string[];
  readonly failure: {
    readonly code: ModelAnalysisFailureCode;
  };
  readonly lastTrace?: AnalysisTrace;
}

export type ReliableAnalysisResult = ValidatedAnalysisResult | FallbackAnalysisResult;

export interface ReliableAnalysisServiceDependencies {
  readonly analysisRunner: AnalysisRunner;
  readonly maxRetries?: number;
}

function isModelAnalysisFailure(
  error: unknown,
): error is ApplicationError<ModelAnalysisFailureCode> {
  return (
    error instanceof ApplicationError &&
    (error.code === 'MODEL_OUTPUT_INVALID' ||
      error.code === 'TIMEOUT' ||
      error.code === 'RATE_LIMITED' ||
      error.code === 'AUTHENTICATION_FAILED' ||
      error.code === 'PROVIDER_UNAVAILABLE' ||
      error.code === 'PROVIDER_REJECTED' ||
      error.code === 'MODEL_REFUSAL' ||
      error.code === 'INCOMPLETE_RESPONSE' ||
      error.code === 'INVALID_PROVIDER_RESPONSE')
  );
}

function reviewReasonFor(
  error: ApplicationError<ModelAnalysisFailureCode>,
): 'MODEL_OUTPUT_INVALID' | 'MODEL_CALL_FAILED' {
  return error.code === 'MODEL_OUTPUT_INVALID' ? 'MODEL_OUTPUT_INVALID' : 'MODEL_CALL_FAILED';
}

function lastTraceFor(
  error: ApplicationError<ModelAnalysisFailureCode>,
): AnalysisTrace | undefined {
  return error instanceof AnalysisOutputValidationError ? error.trace : undefined;
}

export class ReliableAnalysisService {
  private readonly analysisRunner: AnalysisRunner;
  private readonly maxRetries: number;

  constructor({ analysisRunner, maxRetries = 1 }: ReliableAnalysisServiceDependencies) {
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 1) {
      throw new RangeError('maxRetries must be an integer from 0 through 1');
    }

    this.analysisRunner = analysisRunner;
    this.maxRetries = maxRetries;
  }

  async analyze(caseInput: CaseInput, context?: AnalysisContext): Promise<ReliableAnalysisResult> {
    let retryCount = 0;
    const executionContext =
      context === undefined || context.toolRoundBudget !== undefined
        ? context
        : { ...context, toolRoundBudget: new ToolRoundBudget() };

    for (;;) {
      try {
        const execution = await this.analysisRunner.analyze(caseInput, executionContext);

        return {
          type: 'validated',
          analysis: execution.analysis,
          trace: execution.trace,
          retryCount,
          toolNames: [
            ...new Set([
              ...(executionContext?.toolRoundBudget?.invokedToolNames ?? []),
              ...(execution.trace.tools?.map(({ toolName }) => toolName) ?? []),
            ]),
          ],
        };
      } catch (error) {
        if (!isModelAnalysisFailure(error)) {
          throw error;
        }

        if (error.retryable && retryCount < this.maxRetries) {
          retryCount += 1;
          continue;
        }

        const lastTrace = lastTraceFor(error);

        return {
          type: 'fallback',
          analysisStatus: 'fallback',
          analysis: null,
          reviewDecision: {
            reviewRequired: true,
            reviewReasons: [reviewReasonFor(error)],
          },
          retryCount,
          toolNames: executionContext?.toolRoundBudget?.invokedToolNames ?? [],
          failure: { code: error.code },
          ...(lastTrace === undefined ? {} : { lastTrace }),
        };
      }
    }
  }
}
