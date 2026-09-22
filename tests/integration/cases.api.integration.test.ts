import { randomUUID } from 'node:crypto';

import pino from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/db/prisma.js';
import { PrismaCaseRepository } from '../../src/repositories/prisma-case.repository.js';

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
});
