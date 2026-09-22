import { GeminiLLMClient } from './gemini-llm-client.js';
import { GroqLLMClient } from './groq-llm-client.js';
import type { LLMClient } from './llm-client.interface.js';
import { OpenAILLMClient } from './openai-llm-client.js';

export type LLMProvider = 'openai' | 'gemini' | 'groq';

export interface LLMClientConfig {
  readonly provider: LLMProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export function createLLMClient(config: LLMClientConfig): LLMClient {
  const sharedOptions = {
    apiKey: config.apiKey,
    model: config.model,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
  };

  switch (config.provider) {
    case 'openai':
      return new OpenAILLMClient(sharedOptions);
    case 'gemini':
      return new GeminiLLMClient(sharedOptions);
    case 'groq':
      return new GroqLLMClient(sharedOptions);
  }
}
