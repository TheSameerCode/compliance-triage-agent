import { randomUUID } from 'node:crypto';

import pino from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/db/prisma.js';
import { PrismaCaseRepository } from '../../src/repositories/prisma-case.repository.js';
import type { ReliableAnalyzer } from '../../src/services/triage.service.js';
import { TriageService } from '../../src/services/triage.service.js';

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
    const reliableAnalyzer: ReliableAnalyzer = {
      analyze: () =>
        Promise.resolve({
          type: 'validated',
          analysis: {
            category: 'safeguarding',
            severity: 'high',
            summary: 'A neutral synthetic safeguarding summary.',
            missingInformation: ['Event date'],
            indicators: ['A safeguarding concern was reported.'],
            confidence: 0.7,
            modelSuggestsHumanReview: false,
          },
          retryCount: 1,
          trace: {
            model: 'fake-model',
            promptVersion: 'triage-v1',
            providerResponseId: 'response-integration-01',
            latencyMs: 10,
            usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
          },
        }),
    };
    const analysisApp = createApp({
      caseRepository,
      triageService: createTriageService(reliableAnalyzer),
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
      analysisStatus: 'completed',
      reviewRequired: true,
      retryCount: 1,
      inputTokens: 100,
      outputTokens: 40,
    });
    expect(persistedCase.analysisRuns[0]?.reviewReasons).toEqual(
      analysisBody.data.reviewDecision.reviewReasons,
    );

    const retrievalResponse = await request(analysisApp).get(`/api/cases/${caseId}`).expect(200);
    const retrievalBody = responseBody<RetrievedCaseResponseBody>(retrievalResponse);
    expect(retrievalBody.data.analysisRuns[0]?.reviewReasons).toEqual(
      analysisBody.data.reviewDecision.reviewReasons,
    );
  });

  it('persists a provider fallback with mandatory review and no invented analysis', async () => {
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
          retryCount: 1,
          failure: { code: 'TIMEOUT' },
        }),
    };
    const analysisApp = createApp({
      caseRepository,
      triageService: createTriageService(reliableAnalyzer),
      logger: pino({ level: 'silent' }),
    });
    const createdCase = await prisma.case.create({
      data: {
        description: 'A synthetic provider-fallback integration report.',
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
      failure: { code: 'TIMEOUT' },
      reviewDecision: { reviewReasons: ['MODEL_CALL_FAILED'] },
    });

    const persistedCase = await prisma.case.findUniqueOrThrow({
      where: { id: createdCase.id },
      include: { analysisRuns: true },
    });
    expect(persistedCase.status).toBe('REVIEW_REQUIRED');
    expect(persistedCase.analysisRuns[0]).toMatchObject({
      analysisStatus: 'fallback',
      category: null,
      severity: null,
      summary: null,
      confidence: null,
      reviewRequired: true,
      reviewReasons: ['MODEL_CALL_FAILED'],
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
