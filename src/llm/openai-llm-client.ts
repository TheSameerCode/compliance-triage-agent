import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { ZodError } from 'zod';

import { caseAnalysisSchema, type CaseAnalysis } from '../domain/analysis.schemas.js';
import { LLMClientError } from './llm-errors.js';
import type {
  LLMAnalysisRequest,
  LLMClient,
  LLMResult,
  LLMToolCall,
  LLMUsage,
} from './llm-client.interface.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1_200;

export interface OpenAILLMClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

function normalizeOpenAIError(error: unknown): LLMClientError {
  if (error instanceof LLMClientError) {
    return error;
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new LLMClientError('TIMEOUT', true, { cause: error });
  }

  if (error instanceof RateLimitError) {
    return new LLMClientError('RATE_LIMITED', true, { cause: error });
  }

  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new LLMClientError('AUTHENTICATION_FAILED', false, { cause: error });
  }

  if (error instanceof SyntaxError || error instanceof ZodError) {
    return new LLMClientError('INVALID_PROVIDER_RESPONSE', false, { cause: error });
  }

  if (error instanceof APIConnectionError || (error instanceof APIError && error.status >= 500)) {
    return new LLMClientError('PROVIDER_UNAVAILABLE', true, { cause: error });
  }

  if (error instanceof APIError) {
    return new LLMClientError('PROVIDER_REJECTED', false, { cause: error });
  }

  return new LLMClientError('PROVIDER_UNAVAILABLE', true, { cause: error });
}

function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson) as unknown;
  } catch (error) {
    throw new LLMClientError('INVALID_PROVIDER_RESPONSE', false, { cause: error });
  }
}

function findRefusal(output: readonly unknown[]): boolean {
  return output.some((item) => {
    if (typeof item !== 'object' || item === null || !('type' in item) || item.type !== 'message') {
      return false;
    }

    if (!('content' in item) || !Array.isArray(item.content)) {
      return false;
    }

    return item.content.some(
      (content: unknown) =>
        typeof content === 'object' &&
        content !== null &&
        'type' in content &&
        content.type === 'refusal',
    );
  });
}

function usageMetadata(
  usage:
    | {
        readonly input_tokens: number;
        readonly output_tokens: number;
        readonly total_tokens: number;
      }
    | undefined,
): LLMUsage | undefined {
  return usage === undefined
    ? undefined
    : {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens,
      };
}

export class OpenAILLMClient implements LLMClient {
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: OpenAILLMClientOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  async analyze(request: LLMAnalysisRequest): Promise<LLMResult> {
    try {
      const tools = request.tools?.map((tool) => ({
        type: 'function' as const,
        name: tool.name,
        description: tool.description,
        parameters: { ...tool.parameters },
        strict: true,
      }));
      const response = await this.client.responses.parse({
        model: this.model,
        instructions: request.systemPrompt,
        input: [
          {
            role: 'user',
            content: JSON.stringify({ report: request.caseInput }),
          },
        ],
        text: {
          format: zodTextFormat(caseAnalysisSchema, 'case_analysis'),
        },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        parallel_tool_calls: false,
        store: false,
        ...(tools === undefined || tools.length === 0 ? {} : { tools }),
      });

      if (response.error !== null) {
        throw new LLMClientError('PROVIDER_REJECTED', false);
      }

      if (response.status !== 'completed') {
        throw new LLMClientError('INCOMPLETE_RESPONSE', true);
      }

      if (findRefusal(response.output)) {
        throw new LLMClientError('MODEL_REFUSAL', false);
      }

      const usage = usageMetadata(response.usage);
      const metadata = {
        model: response.model ?? this.model,
        providerResponseId: response.id,
        ...(usage === undefined ? {} : { usage }),
      };
      const toolCalls: LLMToolCall[] = response.output
        .filter((item) => item.type === 'function_call')
        .map((call) => ({
          id: call.call_id,
          name: call.name,
          arguments: parseToolArguments(call.arguments),
        }));

      if (toolCalls.length > 0) {
        return { type: 'tool_request', toolCalls, ...metadata };
      }

      const parsedOutput: CaseAnalysis | null = response.output_parsed;

      if (parsedOutput === null) {
        throw new LLMClientError('INVALID_PROVIDER_RESPONSE', false);
      }

      return { type: 'analysis', rawOutput: parsedOutput, ...metadata };
    } catch (error) {
      throw normalizeOpenAIError(error);
    }
  }
}
