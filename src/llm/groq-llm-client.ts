import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
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

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1_200;

export interface GroqLLMClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

function normalizeGroqError(error: unknown): LLMClientError {
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

function usageMetadata(
  usage:
    | {
        readonly prompt_tokens: number;
        readonly completion_tokens: number;
        readonly total_tokens: number;
      }
    | undefined,
): LLMUsage | undefined {
  return usage === undefined
    ? undefined
    : {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      };
}

export class GroqLLMClient implements LLMClient {
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: GroqLLMClientOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: GROQ_BASE_URL,
      maxRetries: 0,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  async analyze(request: LLMAnalysisRequest): Promise<LLMResult> {
    try {
      const schema = z.toJSONSchema(caseAnalysisSchema);
      const tools = request.tools?.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: { ...tool.parameters },
        },
      }));
      const hasTools = tools !== undefined && tools.length > 0;
      const schemaInstruction = hasTools
        ? `If no tool is needed, return only JSON matching this schema: ${JSON.stringify(schema)}`
        : undefined;
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              schemaInstruction === undefined
                ? request.systemPrompt
                : `${request.systemPrompt}\n\n${schemaInstruction}`,
          },
          {
            role: 'user',
            content: JSON.stringify({ report: request.caseInput }),
          },
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        response_format: hasTools
          ? { type: 'json_object' }
          : {
              type: 'json_schema',
              json_schema: {
                name: 'case_analysis',
                strict: true,
                schema,
              },
            },
        ...(hasTools ? { tools, tool_choice: 'auto' as const } : {}),
      });
      const choice = response.choices[0];

      if (choice === undefined) {
        throw new LLMClientError('INVALID_PROVIDER_RESPONSE', false);
      }

      if (choice.finish_reason === 'length') {
        throw new LLMClientError('INCOMPLETE_RESPONSE', true);
      }

      if (
        choice.finish_reason === 'content_filter' ||
        (typeof choice.message.refusal === 'string' && choice.message.refusal.length > 0)
      ) {
        throw new LLMClientError('MODEL_REFUSAL', false);
      }

      const usage = usageMetadata(response.usage);
      const metadata = {
        model: response.model,
        providerResponseId: response.id,
        ...(usage === undefined ? {} : { usage }),
      };
      const toolCalls: LLMToolCall[] = (choice.message.tool_calls ?? [])
        .filter((toolCall) => toolCall.type === 'function')
        .map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: parseToolArguments(toolCall.function.arguments),
        }));

      if (toolCalls.length > 0) {
        return { type: 'tool_request', toolCalls, ...metadata };
      }

      if (choice.message.content === null || choice.message.content.trim().length === 0) {
        throw new LLMClientError('INVALID_PROVIDER_RESPONSE', false);
      }

      const parsedOutput = caseAnalysisSchema.parse(JSON.parse(choice.message.content) as unknown);

      return { type: 'analysis', rawOutput: parsedOutput, ...metadata };
    } catch (error) {
      throw normalizeGroqError(error);
    }
  }
}
