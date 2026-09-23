import { describe, expect, it } from 'vitest';

import { loadEnvironment } from '../../src/config/env.js';

const testDatabaseUrl = 'postgresql://postgres:postgres@localhost:5432/compliance_agent_test';

describe('loadEnvironment', () => {
  it('loads test configuration without an LLM API key', () => {
    const environment = loadEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
    });

    expect(environment).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL: testDatabaseUrl,
      LLM_PROVIDER: 'openai',
      LOG_LEVEL: 'info',
      MAX_LLM_RETRIES: 1,
      HUMAN_REVIEW_CONFIDENCE_THRESHOLD: 0.75,
    });
    expect(environment.LLM_API_KEY).toBeUndefined();
  });

  it('rejects an invalid port with a clear field name', () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: testDatabaseUrl,
        PORT: 'not-a-port',
      }),
    ).toThrow(/PORT/u);
  });

  it('accepts Gemini as an LLM provider', () => {
    const environment = loadEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      LLM_PROVIDER: 'gemini',
    });

    expect(environment.LLM_PROVIDER).toBe('gemini');
  });

  it('accepts Groq as an LLM provider', () => {
    const environment = loadEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      LLM_PROVIDER: 'groq',
    });

    expect(environment.LLM_PROVIDER).toBe('groq');
  });

  it('rejects a missing database URL with a clear field name', () => {
    expect(() => loadEnvironment({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/u);
  });

  it('allows the base API to start in production without optional LLM credentials', () => {
    const environment = loadEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: testDatabaseUrl,
    });

    expect(environment.LLM_MODEL).toBeUndefined();
    expect(environment.LLM_API_KEY).toBeUndefined();
  });

  it.each([
    [{ LLM_MODEL: 'test-model' }, /LLM_API_KEY/u],
    [{ LLM_API_KEY: 'test-key-not-real' }, /LLM_MODEL/u],
  ])('rejects incomplete LLM configuration', (llmConfiguration, expectedError) => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: testDatabaseUrl,
        ...llmConfiguration,
      }),
    ).toThrow(expectedError);
  });
});
