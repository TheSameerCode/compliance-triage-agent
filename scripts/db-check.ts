import 'dotenv/config';

import { createPrismaClient } from '../src/db/prisma.js';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required for the database connectivity check');
}

const prisma = createPrismaClient(databaseUrl);
let smokeCaseId: string | undefined;

try {
  const result = await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`;

  if (result[0]?.value !== 1) {
    throw new Error('Database connectivity check returned an unexpected result');
  }

  const smokeCase = await prisma.case.create({
    data: {
      description: 'Synthetic database smoke-test report with no real person or allegation.',
      reporterType: 'automated-test',
      subjectRef: 'subject_smoke_test',
    },
  });
  smokeCaseId = smokeCase.id;

  const retrievedCase = await prisma.case.findUnique({ where: { id: smokeCase.id } });

  if (retrievedCase?.status !== 'NEW' || retrievedCase.subjectRef !== 'subject_smoke_test') {
    throw new Error('Case persistence check returned an unexpected record');
  }

  const analysisRunData = {
    caseId: smokeCase.id,
    model: 'fake-smoke-model',
    promptVersion: 'smoke-v1',
    category: 'other' as const,
    severity: 'low' as const,
    summary: 'Synthetic smoke-test analysis.',
    confidence: 0.9,
    missingInformation: [],
    indicators: ['synthetic smoke test'],
    modelSuggestsHumanReview: false,
    reviewRequired: false,
    reviewReasons: [],
    analysisStatus: 'completed' as const,
    retryCount: 0,
    latencyMs: 1,
  };

  const firstRun = await prisma.analysisRun.create({ data: analysisRunData });
  const secondRun = await prisma.analysisRun.create({ data: analysisRunData });

  if (firstRun.id === secondRun.id) {
    throw new Error('Separate analysis executions must create distinct run records');
  }

  const storedRunCount = await prisma.analysisRun.count({ where: { caseId: smokeCase.id } });

  if (storedRunCount !== 2) {
    throw new Error('Analysis run persistence check returned an unexpected count');
  }

  console.info('Database connectivity, case, and analysis-run persistence checks passed');
} finally {
  if (smokeCaseId !== undefined) {
    await prisma.analysisRun.deleteMany({ where: { caseId: smokeCaseId } });
    await prisma.case.deleteMany({ where: { id: smokeCaseId } });
  }

  await prisma.$disconnect();
}
