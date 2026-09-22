import { performance } from 'node:perf_hooks';

import { caseAnalysisSchema, type CaseAnalysis } from '../domain/analysis.schemas.js';
import type { CaseInput } from '../domain/case.schemas.js';
import { ApplicationError, ToolExecutionError } from '../errors/application-error.js';
import type { LLMClient, LLMResult, LLMUsage } from '../llm/llm-client.interface.js';
import { createTriageRequest } from '../llm/prompts/index.js';
import {
  ToolRoundBudget,
  type ToolExecutionTrace,
  type ToolRegistry,
} from '../tools/tool-registry.js';

export interface AnalysisTrace {
  readonly model: string;
  readonly promptVersion: string;
  readonly providerResponseId: string;
  readonly latencyMs: number;
  readonly usage?: LLMUsage;
  readonly tools?: readonly ToolExecutionTrace[];
}

export interface AnalysisExecution {
  readonly analysis: CaseAnalysis;
  readonly trace: AnalysisTrace;
}

export interface AnalysisValidationIssue {
  readonly code: string;
  readonly path: string;
}

export class AnalysisOutputValidationError extends ApplicationError<'MODEL_OUTPUT_INVALID'> {
  readonly issues: readonly AnalysisValidationIssue[];
  readonly trace: AnalysisTrace;

  constructor(issues: readonly AnalysisValidationIssue[], trace: AnalysisTrace) {
    super(
      'AnalysisOutputValidationError',
      'MODEL_OUTPUT_INVALID',
      'Model output failed application validation',
      true,
    );
    this.issues = issues;
    this.trace = trace;
  }
}

export interface AnalysisServiceDependencies {
  readonly llmClient: LLMClient;
  readonly toolRegistry?: ToolRegistry;
  readonly now?: () => number;
}

export interface AnalysisContext {
  readonly caseId: string;
  readonly toolRoundBudget?: ToolRoundBudget;
}

function createTrace(
  result: LLMResult,
  promptVersion: string,
  latencyMs: number,
  usage: LLMUsage | undefined = result.usage,
  tools: readonly ToolExecutionTrace[] = [],
): AnalysisTrace {
  return {
    model: result.model,
    promptVersion,
    providerResponseId: result.providerResponseId,
    latencyMs,
    ...(usage === undefined ? {} : { usage }),
    ...(tools.length === 0 ? {} : { tools }),
  };
}

function combineUsage(
  first: LLMUsage | undefined,
  second: LLMUsage | undefined,
): LLMUsage | undefined {
  if (first === undefined || second === undefined) {
    return undefined;
  }

  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
}

function elapsedMilliseconds(start: number, end: number): number {
  return Math.max(0, Math.round(end - start));
}

export class AnalysisService {
  private readonly llmClient: LLMClient;
  private readonly toolRegistry: ToolRegistry | undefined;
  private readonly now: () => number;

  constructor({
    llmClient,
    toolRegistry,
    now = () => performance.now(),
  }: AnalysisServiceDependencies) {
    this.llmClient = llmClient;
    this.toolRegistry = toolRegistry;
    this.now = now;
  }

  async analyze(caseInput: CaseInput, context?: AnalysisContext): Promise<AnalysisExecution> {
    const toolRoundBudget = context?.toolRoundBudget ?? new ToolRoundBudget();
    const canUseTools =
      this.toolRegistry !== undefined &&
      context !== undefined &&
      caseInput.subjectRef !== undefined &&
      toolRoundBudget.available;
    const request = createTriageRequest(
      caseInput,
      canUseTools ? this.toolRegistry.definitions : undefined,
    );
    const startedAt = this.now();
    const initialResult = await this.llmClient.analyze(request);
    let result = initialResult;
    let usage = initialResult.usage;
    const toolTraces: ToolExecutionTrace[] = [];

    if (initialResult.type === 'tool_request') {
      if (!canUseTools || initialResult.toolCalls.length !== 1) {
        throw new ToolExecutionError();
      }

      if (!toolRoundBudget.tryConsume()) {
        throw new ToolExecutionError();
      }

      const toolCall = initialResult.toolCalls[0];

      if (toolCall === undefined || context === undefined || caseInput.subjectRef === undefined) {
        throw new ToolExecutionError();
      }

      const executed = await this.toolRegistry.execute(toolCall, {
        caseId: context.caseId,
        subjectRef: caseInput.subjectRef,
      });
      toolTraces.push(executed.trace);
      result = await this.llmClient.analyze({
        ...request,
        toolContinuation: {
          previousResponseId: initialResult.providerResponseId,
          toolCalls: initialResult.toolCalls,
          toolResults: [executed.result],
        },
      });
      usage = combineUsage(initialResult.usage, result.usage);

      if (result.type === 'tool_request') {
        throw new ToolExecutionError();
      }
    }

    const trace = createTrace(
      result,
      request.promptVersion,
      elapsedMilliseconds(startedAt, this.now()),
      usage,
      toolTraces,
    );

    if (result.type !== 'analysis') {
      throw new AnalysisOutputValidationError(
        [{ code: 'unexpected_result_type', path: 'type' }],
        trace,
      );
    }

    const parsed = caseAnalysisSchema.safeParse(result.rawOutput);

    if (!parsed.success) {
      throw new AnalysisOutputValidationError(
        parsed.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.length === 0 ? '$' : issue.path.map(String).join('.'),
        })),
        trace,
      );
    }

    return {
      analysis: parsed.data,
      trace,
    };
  }
}
