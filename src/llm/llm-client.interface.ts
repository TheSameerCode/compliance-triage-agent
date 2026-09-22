import type { CaseInput } from '../domain/case.schemas.js';

export interface LLMToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface LLMAnalysisRequest {
  readonly caseInput: CaseInput;
  readonly promptVersion: string;
  readonly systemPrompt: string;
  readonly tools?: readonly LLMToolDefinition[];
}

export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface LLMToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

interface LLMResultMetadata {
  readonly model: string;
  readonly providerResponseId: string;
  readonly usage?: LLMUsage;
}

export interface LLMAnalysisResult extends LLMResultMetadata {
  readonly type: 'analysis';
  readonly rawOutput: unknown;
}

export interface LLMToolRequestResult extends LLMResultMetadata {
  readonly type: 'tool_request';
  readonly toolCalls: readonly LLMToolCall[];
}

export type LLMResult = LLMAnalysisResult | LLMToolRequestResult;

export interface LLMClient {
  readonly model: string;
  analyze(request: LLMAnalysisRequest): Promise<LLMResult>;
}
