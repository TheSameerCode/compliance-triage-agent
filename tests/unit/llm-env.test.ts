import { describe, expect, it } from 'vitest';

import { loadLLMEnvironment } from '../../src/config/llm-env.js';

describe('loadLLMEnvironment', () => {
  it('loads Gemini smoke configuration without database settings', () => {
    expect(
      loadLLMEnvironment({
        LLM_PROVIDER: 'gemini',
        LLM_MODEL: 'gemini-test-model',
        LLM_API_KEY: 'test-key-not-real',
      }),
    ).toEqual({
      LLM_PROVIDER: 'gemini',
      LLM_MODEL: 'gemini-test-model',
      LLM_API_KEY: 'test-key-not-real',
    });
  });

  it('reports missing LLM settings by field name', () => {
    expect(() => loadLLMEnvironment({ LLM_PROVIDER: 'gemini' })).toThrow(/LLM_MODEL.*LLM_API_KEY/u);
  });
});
