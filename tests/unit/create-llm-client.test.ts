import { describe, expect, it } from 'vitest';

import { createLLMClient } from '../../src/llm/create-llm-client.js';
import { GeminiLLMClient } from '../../src/llm/gemini-llm-client.js';
import { OpenAILLMClient } from '../../src/llm/openai-llm-client.js';

describe('createLLMClient', () => {
  it('creates the configured provider adapter', () => {
    const shared = { apiKey: 'test-key-not-real', model: 'test-model' };

    expect(createLLMClient({ provider: 'openai', ...shared })).toBeInstanceOf(OpenAILLMClient);
    expect(createLLMClient({ provider: 'gemini', ...shared })).toBeInstanceOf(GeminiLLMClient);
  });
});
