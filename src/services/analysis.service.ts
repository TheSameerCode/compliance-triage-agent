import { performance } from 'node:perf_hooks';

import { caseAnalysisSchema, type CaseAnalysis } from '../domain/analysis.schemas.js';
import type { CaseInput } from '../domain/case.schemas.js';
import type { LLMClient, LLMResult, LLMUsage } from '../llm/llm-client.interface.js';
import { createTriageRequest } from '../llm/prompts/index.js';

export interface AnalysisTrace {
  readonly model: string;
  readonly promptVersion: string;
  readonly providerResponseId: string;
  readonly latencyMs: number;
  readonly usage?: LLMUsage;
}

export interface AnalysisExecution {
  readonly analysis: CaseAnalysis;
  readonly trace: AnalysisTrace;
}

export interface AnalysisValidationIssue {
  readonly code: string;
  readonly path: string;
}

export class AnalysisOutputValidationError extends Error {
  readonly code = 'MODEL_OUTPUT_INVALID' as const;
  readonly issues: readonly AnalysisValidationIssue[];
  readonly trace: AnalysisTrace;

  constructor(issues: readonly AnalysisValidationIssue[], trace: AnalysisTrace) {
    super('Model output failed application validation');
    this.name = 'AnalysisOutputValidationError';
    this.issues = issues;
    this.trace = trace;
  }
}

export interface AnalysisServiceDependencies {
  readonly llmClient: LLMClient;
  readonly now?: () => number;
}

function createTrace(result: LLMResult, promptVersion: string, latencyMs: number): AnalysisTrace {
  return {
    model: result.model,
    promptVersion,
    providerResponseId: result.providerResponseId,
    latencyMs,
    ...(result.usage === undefined ? {} : { usage: result.usage }),
  };
}

function elapsedMilliseconds(start: number, end: number): number {
  return Math.max(0, Math.round(end - start));
}

export class AnalysisService {
  private readonly llmClient: LLMClient;
  private readonly now: () => number;

  constructor({ llmClient, now = () => performance.now() }: AnalysisServiceDependencies) {
    this.llmClient = llmClient;
    this.now = now;
  }

  async analyze(caseInput: CaseInput): Promise<AnalysisExecution> {
    const request = createTriageRequest(caseInput);
    const startedAt = this.now();
    const result = await this.llmClient.analyze(request);
    const trace = createTrace(
      result,
      request.promptVersion,
      elapsedMilliseconds(startedAt, this.now()),
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
