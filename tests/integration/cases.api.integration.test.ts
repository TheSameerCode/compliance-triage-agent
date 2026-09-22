import { randomUUID } from 'node:crypto';

import pino from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/db/prisma.js';
import { PrismaCaseRepository } from '../../src/repositories/prisma-case.repository.js';
import { AnalysisService } from '../../src/services/analysis.service.js';
import { ReliableAnalysisService } from '../../src/services/reliable-analysis.service.js';
import type { ReliableAnalyzer } from '../../src/services/triage.service.js';
import { TriageService } from '../../src/services/triage.service.js';
import { FakeLLMClient, type FakeLLMScenario } from '../support/fake-llm-client.js';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

const prisma = createPrismaClient(databaseUrl);
const caseRepository = new PrismaCaseRepository(prisma);
const app = createApp({ caseRepository, logger: pino({ level: 'silent' }) });
const createdCaseIds: string[] = [];

function responseBody<T>(response: { readonly body: unknown }): T {
  return response.body as T;
}

interface CreatedCaseResponseBody {
  readonly data: { readonly id: string };
}

interface RetrievedCaseResponseBody {
  readonly data: { readonly analysisRuns: readonly Record<string, unknown>[] };
}

function createTriageService(reliableAnalyzer: ReliableAnalyzer, model = 'fake-model') {
  return new TriageService({
    repository: caseRepository,
    reliableAnalyzer,
    model,
    promptVersion: 'triage-v1',
    reviewPolicy: { confidenceThreshold: 0.75 },
  });
}

function createTriageServiceWithFake(scenario: FakeLLMScenario): {
  readonly client: FakeLLMClient;
  readonly service: TriageService;
} {
  const client = new FakeLLMClient({ scenario });
  const reliableAnalyzer = new ReliableAnalysisService({
    analysisRunner: new AnalysisService({ llmClient: client, now: () => 10 }),
  });

  return { client, service: createTriageService(reliableAnalyzer) };
}

describe('case API with PostgreSQL', () => {
  beforeAll(async () => {
    await caseRepository.checkConnection();
  });

  afterEach(async () => {
    if (createdCaseIds.length === 0) {
      return;
    }

    const ids = createdCaseIds.splice(0);
    await prisma.analysisRun.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.case.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('serves the health boundary with the real repository wired', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
    await request(app).get('/ready').expect(200, { status: 'ready' });
  });

  it('rejects invalid input without persisting a case', async () => {
    const subjectRef = `subject_phase13_invalid_${randomUUID()}`;

    await request(app)
      .post('/api/cases')
      .send({ description: 'too short', subjectRef })
      .expect(400);

    await expect(prisma.case.count({ where: { subjectRef } })).resolves.toBe(0);
  });

  it('returns 404 for analysis of an unknown case without persisting a run', async () => {
    const missingCaseId = `missing_${randomUUID()}`;
    const { service } = createTriageServiceWithFake({ type: 'valid' });
    const analysisApp = createApp({
      caseRepository,
      triageService: service,
      logger: pino({ level: 'silent' }),
    });
    const runCountBefore = await prisma.analysisRun.count();

    await request(analysisApp).post(`/api/cases/${missingCaseId}/analyze`).expect(404);

    await expect(prisma.analysisRun.count()).resolves.toBe(runCountBefore);
  });

  it('persists a validated case created through HTTP', async () => {
    const response = await request(app)
      .post('/api/cases')
      .send({
        description: 'A synthetic database integration report with sufficient detail.',
        reporterType: 'integration-test',
        subjectRef: 'subject_phase4_integration',
      })
      .expect(201);

    const caseId = responseBody<CreatedCaseResponseBody>(response).data.id;
    createdCaseIds.push(caseId);

    const persisted = await prisma.case.findUnique({ where: { id: caseId } });
    expect(persisted).toMatchObject({
      id: caseId,
      status: 'NEW',
      reporterType: 'integration-test',
      subjectRef: 'subject_phase4_integration',
    });
  });

  it('retrieves persisted analysis history newest-first without internal trace fields', async () => {
    const olderRunId = `phase4_run_older_${randomUUID()}`;
    const newerRunId = `phase4_run_newer_${randomUUID()}`;
    const persistedCase = await prisma.case.create({
      data: {
        description: 'A synthetic retrieval integration fixture with analysis history.',
        subjectRef: 'subject_phase4_history',
      },
    });
    createdCaseIds.push(persistedCase.id);

    await prisma.analysisRun.createMany({
      data: [
        {
          id: olderRunId,
          caseId: persistedCase.id,
          model: 'fake-model',
          promptVersion: 'test-v1',
          missingInformation: [],
          indicators: [],
          reviewRequired: true,
          reviewReasons: ['MODEL_CALL_FAILED'],
          analysisStatus: 'fallback',
          retryCount: 1,
          latencyMs: 20,
          createdAt: new Date('2026-09-20T10:00:00.000Z'),
        },
        {
          id: newerRunId,
          caseId: persistedCase.id,
          model: 'fake-model',
          promptVersion: 'test-v1',
          category: 'privacy',
          severity: 'medium',
          summary: 'Synthetic privacy concern.',
          confidence: 0.8,
          missingInformation: ['Consent context'],
          indicators: ['Unexpected disclosure'],
          modelSuggestsHumanReview: true,
          reviewRequired: true,
          reviewReasons: ['MODEL_SUGGESTED_REVIEW'],
          analysisStatus: 'completed',
          retryCount: 0,
          latencyMs: 15,
          createdAt: new Date('2026-09-20T10:01:00.000Z'),
        },
      ],
    });

    const response = await request(app).get(`/api/cases/${persistedCase.id}`).expect(200);

    const body = responseBody<RetrievedCaseResponseBody>(response);
    expect(body.data.analysisRuns.map((run) => run.id)).toEqual([newerRunId, olderRunId]);
    expect(body.data.analysisRuns[0]).not.toHaveProperty('model');
    expect(body.data.analysisRuns[0]).not.toHaveProperty('promptVersion');
    expect(body.data.analysisRuns[0]).not.toHaveProperty('latencyMs');
  });

  it('persists policy reasons and case routing atomically through the analysis endpoint', async () => {
    const { client, service } = createTriageServiceWithFake({
      type: 'invalid_then_valid',
      analysis: {
        category: 'safeguarding',
        severity: 'high',
        summary: 'A neutral synthetic safeguarding summary.',
        missingInformation: ['Event date'],
        indicators: ['A safeguarding concern was reported.'],
        confidence: 0.7,
        modelSuggestsHumanReview: false,
      },
    });
    const analysisApp = createApp({
      caseRepository,
      triageService: service,
      logger: pino({ level: 'silent' }),
    });
    const createResponse = await request(analysisApp)
      .post('/api/cases')
      .send({
        description: 'A synthetic safeguarding integration report with sufficient detail.',
        reporterType: 'integration-test',
        subjectRef: 'subject_phase8_policy',
      })
      .expect(201);
    const caseId = responseBody<CreatedCaseResponseBody>(createResponse).data.id;
    createdCaseIds.push(caseId);

    const analysisResponse = await request(analysisApp)
      .post(`/api/cases/${caseId}/analyze`)
      .expect(200);
    const analysisBody = responseBody<{
      readonly data: {
        readonly analysisRunId: string;
        readonly caseStatus: string;
        readonly reviewDecision: {
          readonly reviewRequired: boolean;
          readonly reviewReasons: readonly string[];
        };
      };
    }>(analysisResponse);

    expect(analysisBody.data).toMatchObject({
      caseStatus: 'REVIEW_REQUIRED',
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: [
          'SAFEGUARDING_CATEGORY',
          'HIGH_SEVERITY',
          'LOW_CONFIDENCE',
          'MISSING_INFORMATION',
        ],
      },
    });

    const persistedCase = await prisma.case.findUniqueOrThrow({
      where: { id: caseId },
      include: { analysisRuns: true },
    });
    expect(persistedCase.status).toBe('REVIEW_REQUIRED');
    expect(persistedCase.analysisRuns).toHaveLength(1);
    expect(persistedCase.analysisRuns[0]).toMatchObject({
      id: analysisBody.data.analysisRunId,
      model: 'fake-model',
      promptVersion: 'triage-v1',
      analysisStatus: 'completed',
      reviewRequired: true,
      retryCount: 1,
      inputTokens: 100,
      outputTokens: 40,
      toolNames: [],
      estimatedCost: null,
    });
    expect(client.callCount).toBe(2);
    expect(persistedCase.analysisRuns[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(persistedCase.analysisRuns[0]?.reviewReasons).toEqual(
      analysisBody.data.reviewDecision.reviewReasons,
    );

    const retrievalResponse = await request(analysisApp).get(`/api/cases/${caseId}`).expect(200);
    const retrievalBody = responseBody<RetrievedCaseResponseBody>(retrievalResponse);
    expect(retrievalBody.data.analysisRuns[0]?.reviewReasons).toEqual(
      analysisBody.data.reviewDecision.reviewReasons,
    );
    expect(retrievalBody.data.analysisRuns[0]).not.toHaveProperty('toolNames');
  });

  it('persists an invalid-output fallback with mandatory review and no invented analysis', async () => {
    const { client, service } = createTriageServiceWithFake({ type: 'repeated_invalid' });
    const analysisApp = createApp({
      caseRepository,
      triageService: service,
      logger: pino({ level: 'silent' }),
    });
    const createdCase = await prisma.case.create({
      data: {
        description: 'A synthetic invalid-output fallback integration report.',
        subjectRef: 'subject_phase8_fallback',
      },
    });
    createdCaseIds.push(createdCase.id);

    const response = await request(analysisApp)
      .post(`/api/cases/${createdCase.id}/analyze`)
      .expect(200);
    const body = responseBody<{
      readonly data: {
        readonly analysisStatus: string;
        readonly analysis: unknown;
        readonly failure: { readonly code: string };
        readonly reviewDecision: { readonly reviewReasons: readonly string[] };
      };
    }>(response);

    expect(body.data).toMatchObject({
      analysisStatus: 'fallback',
      analysis: null,
      failure: { code: 'MODEL_OUTPUT_INVALID' },
      reviewDecision: { reviewReasons: ['MODEL_OUTPUT_INVALID'] },
    });

    const persistedCase = await prisma.case.findUniqueOrThrow({
      where: { id: createdCase.id },
      include: { analysisRuns: true },
    });
    expect(persistedCase.status).toBe('REVIEW_REQUIRED');
    expect(persistedCase.analysisRuns[0]).toMatchObject({
      model: 'fake-model',
      promptVersion: 'triage-v1',
      analysisStatus: 'fallback',
      category: null,
      severity: null,
      summary: null,
      confidence: null,
      reviewRequired: true,
      reviewReasons: ['MODEL_OUTPUT_INVALID'],
      toolNames: [],
      inputTokens: 100,
      outputTokens: 40,
      estimatedCost: null,
    });
    expect(persistedCase.analysisRuns[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(client.callCount).toBe(2);
  });

  it('lists policy-routed cases in the review queue and excludes analyzed controls', async () => {
    const reviewCase = await prisma.case.create({
      data: {
        description: 'A synthetic high-severity report for review-queue testing.',
        subjectRef: `subject_phase13_review_${randomUUID()}`,
      },
    });
    const controlCase = await prisma.case.create({
      data: {
        description: 'A synthetic low-risk control report for review-queue testing.',
        subjectRef: `subject_phase13_control_${randomUUID()}`,
      },
    });
    createdCaseIds.push(reviewCase.id, controlCase.id);
    const reviewTriage = createTriageServiceWithFake({
      type: 'valid',
      analysis: {
        category: 'other',
        severity: 'high',
        summary: 'A neutral synthetic high-severity summary.',
        missingInformation: [],
        indicators: ['A high-severity concern was reported.'],
        confidence: 0.95,
        modelSuggestsHumanReview: false,
      },
    });
    const controlTriage = createTriageServiceWithFake({
      type: 'valid',
      analysis: {
        category: 'other',
        severity: 'low',
        summary: 'A neutral synthetic control summary.',
        missingInformation: [],
        indicators: ['No policy trigger was found.'],
        confidence: 0.95,
        modelSuggestsHumanReview: false,
      },
    });

    await request(
      createApp({
        caseRepository,
        triageService: reviewTriage.service,
        logger: pino({ level: 'silent' }),
      }),
    )
      .post(`/api/cases/${reviewCase.id}/analyze`)
      .expect(200);
    await request(
      createApp({
        caseRepository,
        triageService: controlTriage.service,
        logger: pino({ level: 'silent' }),
      }),
    )
      .post(`/api/cases/${controlCase.id}/analyze`)
      .expect(200);

    const response = await request(app).get('/api/reviews?status=required').expect(200);
    const body = responseBody<{
      readonly data: readonly { readonly id: string; readonly status: string }[];
    }>(response);

    expect(body.data).toContainEqual(
      expect.objectContaining({ id: reviewCase.id, status: 'REVIEW_REQUIRED' }),
    );
    expect(body.data.map(({ id }) => id)).not.toContain(controlCase.id);
    expect(body.data.every(({ status }) => status === 'REVIEW_REQUIRED')).toBe(true);
    await expect(
      prisma.case.findUniqueOrThrow({ where: { id: controlCase.id } }),
    ).resolves.toMatchObject({
      status: 'ANALYZED',
    });
  });

  it('leaves case state unchanged when analysis-run persistence fails', async () => {
    const reliableAnalyzer: ReliableAnalyzer = {
      analyze: () =>
        Promise.resolve({
          type: 'fallback',
          analysisStatus: 'fallback',
          analysis: null,
          reviewDecision: {
            reviewRequired: true,
            reviewReasons: ['MODEL_CALL_FAILED'],
          },
          retryCount: 0,
          toolNames: [],
          failure: { code: 'AUTHENTICATION_FAILED' },
        }),
    };
    const analysisApp = createApp({
      caseRepository,
      triageService: createTriageService(reliableAnalyzer, 'x'.repeat(201)),
      logger: pino({ level: 'silent' }),
    });
    const createdCase = await prisma.case.create({
      data: {
        description: 'A synthetic transaction rollback integration report.',
        subjectRef: 'subject_phase8_rollback',
      },
    });
    createdCaseIds.push(createdCase.id);

    await request(analysisApp).post(`/api/cases/${createdCase.id}/analyze`).expect(500);

    const persistedCase = await prisma.case.findUniqueOrThrow({
      where: { id: createdCase.id },
      include: { analysisRuns: true },
    });
    expect(persistedCase.status).toBe('NEW');
    expect(persistedCase.analysisRuns).toHaveLength(0);
  });

  it('returns only deterministic minimized metadata for earlier cases of the same subject', async () => {
    const subjectRef = `subject_phase9_tool_${randomUUID()}`;
    const [currentCase, earlierOpenCase, earlierClosedCase, unrelatedCase] =
      await prisma.$transaction([
        prisma.case.create({
          data: {
            description: 'Synthetic current narrative that must never appear in tool output.',
            subjectRef,
          },
        }),
        prisma.case.create({
          data: {
            description: 'Synthetic earlier open narrative that must remain private.',
            subjectRef,
            status: 'REVIEW_REQUIRED',
          },
        }),
        prisma.case.create({
          data: {
            description: 'Synthetic earlier closed narrative that must remain private.',
            subjectRef,
            status: 'ANALYZED',
          },
        }),
        prisma.case.create({
          data: {
            description: 'Synthetic unrelated narrative.',
            subjectRef: `unrelated_${randomUUID()}`,
            status: 'REVIEW_REQUIRED',
          },
        }),
      ]);
    createdCaseIds.push(currentCase.id, earlierOpenCase.id, earlierClosedCase.id, unrelatedCase.id);
    await prisma.analysisRun.createMany({
      data: [
        {
          caseId: earlierOpenCase.id,
          model: 'fake-model',
          promptVersion: 'triage-v1',
          category: 'privacy',
          severity: 'medium',
          summary: 'Synthetic private summary.',
          confidence: 0.8,
          missingInformation: [],
          indicators: [],
          modelSuggestsHumanReview: true,
          reviewRequired: true,
          reviewReasons: ['MODEL_SUGGESTED_REVIEW'],
          analysisStatus: 'completed',
          retryCount: 0,
          latencyMs: 10,
        },
        {
          caseId: earlierClosedCase.id,
          model: 'fake-model',
          promptVersion: 'triage-v1',
          category: 'financial',
          severity: 'low',
          summary: 'Another synthetic private summary.',
          confidence: 0.9,
          missingInformation: [],
          indicators: [],
          modelSuggestsHumanReview: false,
          reviewRequired: false,
          reviewReasons: [],
          analysisStatus: 'completed',
          retryCount: 0,
          latencyMs: 10,
        },
      ],
    });

    const metadata = await caseRepository.getPreviousCaseMetadata(subjectRef, currentCase.id);

    expect(metadata).toEqual({
      previousCaseCount: 2,
      categories: ['financial', 'privacy'],
      hasOpenReview: true,
    });
    expect(JSON.stringify(metadata)).not.toContain('narrative');
    expect(JSON.stringify(metadata)).not.toContain('summary');
  });
});
