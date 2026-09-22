import { ApiError, GoogleGenAI } from '@google/genai';
import { ZodError, z } from 'zod';

import { caseAnalysisSchema } from '../domain/analysis.schemas.js';
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

export interface GeminiLLMClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

interface GeminiUsage {
  readonly total_input_tokens?: number | undefined;
  readonly total_output_tokens?: number | undefined;
  readonly total_tokens?: number | undefined;
}

function normalizeGeminiError(error: unknown): LLMClientError {
  if (error instanceof LLMClientError) {
    return error;
  }

  if (
    error instanceof Error &&
    (error.name === 'RequestTimeoutError' || error.name === 'AbortError')
  ) {
    return new LLMClientError('TIMEOUT', true, { cause: error });
  }

  if (error instanceof SyntaxError || error instanceof ZodError) {
    return new LLMClientError('INVALID_PROVIDER_RESPONSE', false, { cause: error });
  }

  const providerStatus =
    error instanceof ApiError
      ? error.status
      : typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          typeof error.status === 'number'
        ? error.status
        : undefined;

  if (providerStatus !== undefined) {
    if (providerStatus === 429) {
      return new LLMClientError('RATE_LIMITED', true, { cause: error });
    }

    if (providerStatus === 401 || providerStatus === 403) {
      return new LLMClientError('AUTHENTICATION_FAILED', false, { cause: error });
    }

    if (providerStatus >= 500) {
      return new LLMClientError('PROVIDER_UNAVAILABLE', true, { cause: error });
    }

    return new LLMClientError('PROVIDER_REJECTED', false, { cause: error });
  }

  return new LLMClientError('PROVIDER_UNAVAILABLE', true, { cause: error });
}

function usageMetadata(usage: GeminiUsage | undefined): LLMUsage | undefined {
  const inputTokens = usage?.total_input_tokens;
  const outputTokens = usage?.total_output_tokens;

  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
  };
}

function toolCallsFromSteps(steps: readonly unknown[] | undefined): LLMToolCall[] {
  if (steps === undefined) {
    return [];
  }

  return steps.flatMap((step) => {
    if (
      typeof step !== 'object' ||
      step === null ||
      !('type' in step) ||
      step.type !== 'function_call' ||
      !('id' in step) ||
      typeof step.id !== 'string' ||
      !('name' in step) ||
      typeof step.name !== 'string' ||
      !('arguments' in step)
    ) {
      return [];
    }

    return [{ id: step.id, name: step.name, arguments: step.arguments }];
  });
}

export class GeminiLLMClient implements LLMClient {
  readonly model: string;
  private readonly client: GoogleGenAI;
  private readonly timeoutMs: number;

  constructor(options: GeminiLLMClientOptions) {
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: {
        timeout: this.timeoutMs,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      },
    });
  }

  async analyze(request: LLMAnalysisRequest): Promise<LLMResult> {
    try {
      const tools = request.tools?.map((tool) => ({
        type: 'function' as const,
        name: tool.name,
        description: tool.description,
        parameters: { ...tool.parameters },
      }));
      const response = await this.client.interactions.create(
        {
          model: this.model,
          system_instruction: request.systemPrompt,
          input: JSON.stringify({ report: request.caseInput }),
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: z.toJSONSchema(caseAnalysisSchema),
          },
          generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
          store: false,
          ...(tools === undefined || tools.length === 0 ? {} : { tools }),
        },
        { maxRetries: 0, timeout: this.timeoutMs },
      );
      const toolCalls = toolCallsFromSteps(response.steps);
      const usage = usageMetadata(response.usage);
      const metadata = {
        model: response.model ?? this.model,
        providerResponseId: response.id,
        ...(usage === undefined ? {} : { usage }),
      };

      if (toolCalls.length > 0) {
        return { type: 'tool_request', toolCalls, ...metadata };
      }

      if (response.status === 'incomplete') {
        throw new LLMClientError('INCOMPLETE_RESPONSE', true);
      }

      if (response.status !== 'completed') {
        throw new LLMClientError('PROVIDER_REJECTED', false);
      }

      if (response.output_text === undefined || response.output_text.trim().length === 0) {
        throw new LLMClientError('INVALID_PROVIDER_RESPONSE', false);
      }

      const parsedOutput = caseAnalysisSchema.parse(JSON.parse(response.output_text) as unknown);

      return { type: 'analysis', rawOutput: parsedOutput, ...metadata };
    } catch (error) {
      throw normalizeGeminiError(error);
    }
  }
}
