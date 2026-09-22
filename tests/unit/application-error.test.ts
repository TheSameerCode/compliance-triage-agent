import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  DatabaseFailureError,
  ToolExecutionError,
} from '../../src/errors/application-error.js';
import { LLMClientError } from '../../src/llm/llm-errors.js';
import { AnalysisOutputValidationError } from '../../src/services/analysis.service.js';

const trace = {
  model: 'fake-model',
  promptVersion: 'triage-v1',
  providerResponseId: 'response-invalid',
  latencyMs: 8,
} as const;

describe('normalized application errors', () => {
  it.each([
    {
      error: new LLMClientError('TIMEOUT', true),
      code: 'TIMEOUT',
      retryable: true,
    },
    {
      error: new AnalysisOutputValidationError([{ code: 'invalid_type', path: 'severity' }], trace),
      code: 'MODEL_OUTPUT_INVALID',
      retryable: true,
    },
    {
      error: new ToolExecutionError(),
      code: 'TOOL_EXECUTION_FAILED',
      retryable: false,
    },
    {
      error: new DatabaseFailureError(),
      code: 'DATABASE_FAILURE',
      retryable: false,
    },
  ])('normalizes $code without a provider SDK type', ({ error, code, retryable }) => {
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error).toMatchObject({ code, retryable });
  });

  it('keeps infrastructure messages generic when an internal cause is present', () => {
    const cause = new Error('postgresql://user:secret@example.test/private');
    const error = new DatabaseFailureError({ cause });

    expect(error.message).toBe('The database operation failed');
    expect(JSON.stringify(error)).not.toContain('secret');
  });
});
