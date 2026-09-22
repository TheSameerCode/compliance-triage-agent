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
  readonly toolContinuation?: LLMToolContinuation;
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

export interface LLMToolResult {
  readonly callId: string;
  readonly name: string;
  readonly output: unknown;
}

export interface LLMToolContinuation {
  readonly previousResponseId: string;
  readonly toolCalls: readonly LLMToolCall[];
  readonly toolResults: readonly LLMToolResult[];
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
