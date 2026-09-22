import { Writable } from 'node:stream';

import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { CaseRecord, CaseRepository } from '../../src/repositories/case.repository.js';
import type { CaseTriageService } from '../../src/services/triage.service.js';

const createdAt = new Date('2026-09-20T10:00:00.000Z');

function createRepository(overrides: Partial<CaseRepository> = {}): CaseRepository {
  return {
    checkConnection: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: 'case_test_01', status: 'NEW', createdAt }),
    findById: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function createSilentLogger() {
  return pino({ level: 'silent' });
}

function responseBody<T>(response: { readonly body: unknown }): T {
  return response.body as T;
}

interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly issues?: readonly unknown[];
  };
}

interface CaseResponseBody {
  readonly data: {
    readonly id: string;
    readonly status: string;
    readonly createdAt: string;
    readonly analysisRuns: readonly Record<string, unknown>[];
  };
}

describe('HTTP application', () => {
  it('serves liveness without opening a process listener', async () => {
    const app = createApp({ caseRepository: createRepository(), logger: createSilentLogger() });

    await request(app).get('/health').expect(200, { status: 'ok' });
  });

  it('reports readiness without exposing database details', async () => {
    const readyApp = createApp({
      caseRepository: createRepository(),
      logger: createSilentLogger(),
    });
    const unavailableApp = createApp({
      caseRepository: createRepository({
        checkConnection: vi.fn().mockRejectedValue(new Error('secret connection details')),
      }),
      logger: createSilentLogger(),
    });

    await request(readyApp).get('/ready').expect(200, { status: 'ready' });
    const unavailable = await request(unavailableApp).get('/ready').expect(503);

    const body = responseBody<unknown>(unavailable);
    expect(body).toEqual({ status: 'not_ready' });
    expect(JSON.stringify(body)).not.toContain('secret connection details');
  });

  it('echoes a valid request ID and generates isolated IDs otherwise', async () => {
    const app = createApp({ caseRepository: createRepository(), logger: createSilentLogger() });

    const supplied = await request(app).get('/health').set('X-Request-Id', 'client-request_01');
    const [generatedOne, generatedTwo] = await Promise.all([
      request(app).get('/health'),
      request(app).get('/health'),
    ]);

    expect(supplied.headers['x-request-id']).toBe('client-request_01');
    expect(generatedOne.headers['x-request-id']).toBeTypeOf('string');
    expect(generatedTwo.headers['x-request-id']).toBeTypeOf('string');
    expect(generatedOne.headers['x-request-id']).not.toBe(generatedTwo.headers['x-request-id']);
  });

  it('creates a validated case without starting analysis', async () => {
    const createCase = vi.fn<CaseRepository['create']>().mockResolvedValue({
      id: 'case_test_01',
      status: 'NEW',
      createdAt,
    });
    const caseRepository = createRepository({ create: createCase });
    const app = createApp({ caseRepository, logger: createSilentLogger() });
    const description = '  A synthetic report with enough detail for case creation.  ';

    const response = await request(app)
      .post('/api/cases')
      .send({ description, reporterType: 'member', subjectRef: 'subject_demo_20' })
      .expect(201);

    expect(response.headers.location).toBe('/api/cases/case_test_01');
    expect(responseBody<unknown>(response)).toEqual({
      data: { id: 'case_test_01', status: 'NEW', createdAt: createdAt.toISOString() },
    });
    expect(createCase).toHaveBeenCalledWith({
      description: description.trim(),
      reporterType: 'member',
      subjectRef: 'subject_demo_20',
    });
  });

  it('returns structured validation errors without calling persistence', async () => {
    const createCase = vi.fn<CaseRepository['create']>().mockResolvedValue({
      id: 'case_test_01',
      status: 'NEW',
      createdAt,
    });
    const caseRepository = createRepository({ create: createCase });
    const app = createApp({ caseRepository, logger: createSilentLogger() });

    const response = await request(app)
      .post('/api/cases')
      .send({ description: 'too short', unexpected: true })
      .expect(400);

    const body = responseBody<ErrorResponseBody>(response);
    expect(body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request body failed validation',
    });
    expect(body.error.requestId).toBeTypeOf('string');
    expect(body.error.issues).toBeInstanceOf(Array);
    expect(createCase).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and payloads above 32kb', async () => {
    const app = createApp({ caseRepository: createRepository(), logger: createSilentLogger() });

    const invalidJson = await request(app)
      .post('/api/cases')
      .set('Content-Type', 'application/json')
      .send('{"description":')
      .expect(400);
    const oversized = await request(app)
      .post('/api/cases')
      .send({ description: 'A'.repeat(33 * 1024) })
      .expect(413);

    expect(responseBody<ErrorResponseBody>(invalidJson).error.code).toBe('INVALID_JSON');
    expect(responseBody<ErrorResponseBody>(oversized).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns case metadata and ordered business analysis history', async () => {
    const caseRecord: CaseRecord = {
      id: 'case_test_02',
      description: 'A synthetic case description that is safe for a test fixture.',
      reporterType: null,
      subjectRef: 'subject_demo_21',
      status: 'REVIEW_REQUIRED',
      createdAt,
      updatedAt: new Date('2026-09-20T10:05:00.000Z'),
      analysisRuns: [
        {
          id: 'run_newer',
          analysisStatus: 'completed',
          category: 'safeguarding',
          severity: 'high',
          summary: 'Neutral synthetic summary.',
          confidence: 0.95,
          missingInformation: [],
          indicators: ['Potential safeguarding concern'],
          modelSuggestsHumanReview: true,
          reviewRequired: true,
          reviewReasons: ['HIGH_SEVERITY'],
          createdAt: new Date('2026-09-20T10:04:00.000Z'),
        },
        {
          id: 'run_older',
          analysisStatus: 'fallback',
          category: null,
          severity: null,
          summary: null,
          confidence: null,
          missingInformation: [],
          indicators: [],
          modelSuggestsHumanReview: null,
          reviewRequired: true,
          reviewReasons: ['MODEL_CALL_FAILED'],
          createdAt: new Date('2026-09-20T10:03:00.000Z'),
        },
      ],
    };
    const app = createApp({
      caseRepository: createRepository({ findById: vi.fn().mockResolvedValue(caseRecord) }),
      logger: createSilentLogger(),
    });

    const response = await request(app).get('/api/cases/case_test_02').expect(200);

    const body = responseBody<CaseResponseBody>(response);
    expect(body.data.analysisRuns.map((run) => run.id)).toEqual(['run_newer', 'run_older']);
    expect(body.data.analysisRuns[0]).not.toHaveProperty('model');
    expect(body.data.analysisRuns[0]).not.toHaveProperty('inputTokens');
    expect(body.data.analysisRuns[0]).not.toHaveProperty('estimatedCost');
  });

  it('returns completed analysis with the application review decision', async () => {
    const analyzeCase = vi.fn<CaseTriageService['analyzeCase']>().mockResolvedValue({
      analysisRunId: 'run_test_01',
      caseStatus: 'REVIEW_REQUIRED',
      analysisStatus: 'completed',
      analysis: {
        category: 'safeguarding',
        severity: 'high',
        summary: 'Neutral synthetic summary.',
        missingInformation: [],
        indicators: ['Safeguarding concern'],
        confidence: 0.99,
        modelSuggestsHumanReview: false,
      },
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: ['SAFEGUARDING_CATEGORY', 'HIGH_SEVERITY'],
      },
      retryCount: 0,
      createdAt,
    });
    const app = createApp({
      caseRepository: createRepository(),
      triageService: { analyzeCase },
      logger: createSilentLogger(),
    });

    const response = await request(app).post('/api/cases/case_test_01/analyze').expect(200);

    expect(responseBody<unknown>(response)).toEqual({
      data: {
        analysisRunId: 'run_test_01',
        caseStatus: 'REVIEW_REQUIRED',
        analysisStatus: 'completed',
        analysis: {
          category: 'safeguarding',
          severity: 'high',
          summary: 'Neutral synthetic summary.',
          missingInformation: [],
          indicators: ['Safeguarding concern'],
          confidence: 0.99,
          modelSuggestsHumanReview: false,
        },
        reviewDecision: {
          reviewRequired: true,
          reviewReasons: ['SAFEGUARDING_CATEGORY', 'HIGH_SEVERITY'],
        },
        retryCount: 0,
        createdAt: createdAt.toISOString(),
      },
    });
    expect(analyzeCase).toHaveBeenCalledWith('case_test_01');
  });

  it('returns a degraded successful response for a persisted provider fallback', async () => {
    const analyzeCase = vi.fn<CaseTriageService['analyzeCase']>().mockResolvedValue({
      analysisRunId: 'run_fallback_01',
      caseStatus: 'REVIEW_REQUIRED',
      analysisStatus: 'fallback',
      analysis: null,
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: ['MODEL_CALL_FAILED'],
      },
      retryCount: 1,
      failure: { code: 'TIMEOUT' },
      createdAt,
    });
    const app = createApp({
      caseRepository: createRepository(),
      triageService: { analyzeCase },
      logger: createSilentLogger(),
    });

    const response = await request(app).post('/api/cases/case_test_01/analyze').expect(200);
    const body = responseBody<{
      readonly data: {
        readonly analysis: unknown;
        readonly analysisStatus: string;
        readonly reviewDecision: { readonly reviewRequired: boolean };
        readonly failure: { readonly code: string };
      };
    }>(response);

    expect(body.data).toMatchObject({
      analysisStatus: 'fallback',
      analysis: null,
      reviewDecision: { reviewRequired: true },
      failure: { code: 'TIMEOUT' },
    });
  });

  it('returns controlled analysis errors for unknown cases or missing service wiring', async () => {
    const missingCaseApp = createApp({
      caseRepository: createRepository(),
      triageService: { analyzeCase: vi.fn().mockResolvedValue(null) },
      logger: createSilentLogger(),
    });
    const unavailableApp = createApp({
      caseRepository: createRepository(),
      logger: createSilentLogger(),
    });

    const missing = await request(missingCaseApp)
      .post('/api/cases/unknown_case/analyze')
      .expect(404);
    const unavailable = await request(unavailableApp)
      .post('/api/cases/case_test_01/analyze')
      .expect(503);

    expect(responseBody<ErrorResponseBody>(missing).error.code).toBe('CASE_NOT_FOUND');
    expect(responseBody<ErrorResponseBody>(unavailable).error.code).toBe('ANALYSIS_UNAVAILABLE');
  });

  it('returns structured errors for missing cases and unexpected failures', async () => {
    const missingApp = createApp({
      caseRepository: createRepository(),
      logger: createSilentLogger(),
    });
    const failingApp = createApp({
      caseRepository: createRepository({
        findById: vi.fn().mockRejectedValue(new Error('database-password-internal')),
      }),
      logger: createSilentLogger(),
    });

    const missing = await request(missingApp).get('/api/cases/unknown_case').expect(404);
    const failure = await request(failingApp).get('/api/cases/case_test_03').expect(500);

    const missingBody = responseBody<ErrorResponseBody>(missing);
    const failureBody = responseBody<ErrorResponseBody>(failure);
    expect(missingBody.error.code).toBe('CASE_NOT_FOUND');
    expect(failureBody.error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(failureBody)).not.toContain('database-password-internal');
  });

  it('does not write raw case descriptions to structured logs', async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const logger = pino({ level: 'info', base: null }, destination);
    const app = createApp({ caseRepository: createRepository(), logger });
    const sensitiveNarrative = 'Synthetic private narrative that must never enter logs.';

    await request(app).post('/api/cases').send({ description: sensitiveNarrative }).expect(201);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const logs = chunks.join('');
    expect(logs).toContain('case.created');
    expect(logs).toContain('case_test_01');
    expect(logs).not.toContain(sensitiveNarrative);
  });
});
