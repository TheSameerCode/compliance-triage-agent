import 'dotenv/config';

import type { Prisma } from '../src/generated/prisma/client.js';
import { createPrismaClient } from '../src/db/prisma.js';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required to seed synthetic demonstration data');
}

const cases = [
  {
    id: 'case_demo_safe_001',
    description:
      'Synthetic report of repeated private messages between an adult volunteer and a minor participant.',
    reporterType: 'parent',
    subjectRef: 'subject_demo_01',
    status: 'REVIEW_REQUIRED',
  },
  {
    id: 'case_demo_harr_001',
    description:
      'Synthetic report describing repeated insulting comments during volunteer coordination meetings.',
    reporterType: 'volunteer',
    subjectRef: 'subject_demo_01',
    status: 'REVIEW_REQUIRED',
  },
  {
    id: 'case_demo_disc_001',
    description:
      'Synthetic report of unequal access to club activities based on a protected characteristic.',
    reporterType: 'member',
    subjectRef: 'subject_demo_02',
    status: 'REVIEW_REQUIRED',
  },
  {
    id: 'case_demo_fin_001',
    description:
      'Synthetic report of reimbursement records that do not match the associated event expenses.',
    reporterType: 'staff',
    subjectRef: 'subject_demo_03',
    status: 'REVIEW_REQUIRED',
  },
  {
    id: 'case_demo_priv_001',
    description:
      'Synthetic report that participant contact details were shared outside the intended project group.',
    reporterType: 'participant',
    subjectRef: 'subject_demo_04',
    status: 'REVIEW_REQUIRED',
  },
  {
    id: 'case_demo_other_001',
    description:
      'Synthetic report requesting clarification about a routine scheduling and facility-booking disagreement.',
    reporterType: 'member',
    subjectRef: 'subject_demo_05',
    status: 'ANALYZED',
  },
] satisfies Prisma.CaseCreateManyInput[];

const analysisRuns = [
  {
    id: 'run_demo_safe_001',
    caseId: 'case_demo_safe_001',
    model: 'synthetic-seed',
    promptVersion: 'seed-v1',
    category: 'safeguarding',
    severity: 'high',
    summary: 'Synthetic safeguarding metadata for a prior-case lookup demonstration.',
    confidence: 0.93,
    missingInformation: ['message dates'],
    indicators: ['minor involved', 'private communication'],
    modelSuggestsHumanReview: true,
    reviewRequired: true,
    reviewReasons: ['SAFEGUARDING_CATEGORY', 'HIGH_SEVERITY'],
    analysisStatus: 'completed',
    retryCount: 0,
    latencyMs: 1,
  },
  {
    id: 'run_demo_harr_001',
    caseId: 'case_demo_harr_001',
    model: 'synthetic-seed',
    promptVersion: 'seed-v1',
    category: 'harassment',
    severity: 'medium',
    summary: 'Synthetic harassment metadata for a prior-case lookup demonstration.',
    confidence: 0.87,
    missingInformation: [],
    indicators: ['repeated insulting comments'],
    modelSuggestsHumanReview: true,
    reviewRequired: true,
    reviewReasons: ['MODEL_SUGGESTED_REVIEW'],
    analysisStatus: 'completed',
    retryCount: 0,
    latencyMs: 1,
  },
  {
    id: 'run_demo_disc_001',
    caseId: 'case_demo_disc_001',
    model: 'synthetic-seed',
    promptVersion: 'seed-v1',
    category: 'discrimination',
    severity: 'medium',
    summary: 'Synthetic discrimination metadata for a prior-case lookup demonstration.',
    confidence: 0.84,
    missingInformation: ['selection criteria'],
    indicators: ['protected characteristic referenced'],
    modelSuggestsHumanReview: true,
    reviewRequired: true,
    reviewReasons: ['MISSING_INFORMATION', 'MODEL_SUGGESTED_REVIEW'],
    analysisStatus: 'completed',
    retryCount: 0,
    latencyMs: 1,
  },
  {
    id: 'run_demo_fin_001',
    caseId: 'case_demo_fin_001',
    model: 'synthetic-seed',
    promptVersion: 'seed-v1',
    category: 'financial',
    severity: 'high',
    summary: 'Synthetic financial metadata for a prior-case lookup demonstration.',
    confidence: 0.9,
    missingInformation: ['original receipts'],
    indicators: ['expense mismatch'],
    modelSuggestsHumanReview: true,
    reviewRequired: true,
    reviewReasons: ['HIGH_SEVERITY', 'MISSING_INFORMATION'],
    analysisStatus: 'completed',
    retryCount: 0,
    latencyMs: 1,
  },
  {
    id: 'run_demo_priv_001',
    caseId: 'case_demo_priv_001',
    model: 'synthetic-seed',
    promptVersion: 'seed-v1',
    category: 'privacy',
    severity: 'medium',
    summary: 'Synthetic privacy metadata for a prior-case lookup demonstration.',
    confidence: 0.86,
    missingInformation: ['recipient list'],
    indicators: ['contact details shared'],
    modelSuggestsHumanReview: true,
    reviewRequired: true,
    reviewReasons: ['MISSING_INFORMATION', 'MODEL_SUGGESTED_REVIEW'],
    analysisStatus: 'completed',
    retryCount: 0,
    latencyMs: 1,
  },
  {
    id: 'run_demo_other_001',
    caseId: 'case_demo_other_001',
    model: 'synthetic-seed',
    promptVersion: 'seed-v1',
    category: 'other',
    severity: 'low',
    summary: 'Synthetic routine-administration metadata for a prior-case lookup demonstration.',
    confidence: 0.92,
    missingInformation: [],
    indicators: ['routine scheduling disagreement'],
    modelSuggestsHumanReview: false,
    reviewRequired: false,
    reviewReasons: [],
    analysisStatus: 'completed',
    retryCount: 0,
    latencyMs: 1,
  },
] satisfies Prisma.AnalysisRunCreateManyInput[];

const prisma = createPrismaClient(databaseUrl);

try {
  await prisma.$transaction([
    prisma.case.createMany({ data: cases, skipDuplicates: true }),
    prisma.analysisRun.createMany({ data: analysisRuns, skipDuplicates: true }),
  ]);

  const [caseCount, runCount, categoryCounts] = await Promise.all([
    prisma.case.count({ where: { id: { in: cases.map(({ id }) => id) } } }),
    prisma.analysisRun.count({ where: { id: { in: analysisRuns.map(({ id }) => id) } } }),
    prisma.analysisRun.groupBy({
      by: ['category'],
      where: { id: { in: analysisRuns.map(({ id }) => id) } },
      _count: { _all: true },
    }),
  ]);

  if (caseCount !== cases.length || runCount !== analysisRuns.length) {
    throw new Error(
      `Synthetic seed verification failed: expected ${cases.length} cases and ${analysisRuns.length} runs`,
    );
  }

  const expectedCategoryCount = new Set(analysisRuns.map(({ category }) => category)).size;
  const hasUnexpectedCategoryCount = categoryCounts.some(({ _count }) => _count._all !== 1);

  if (categoryCounts.length !== expectedCategoryCount || hasUnexpectedCategoryCount) {
    throw new Error('Synthetic seed verification failed: expected one run in each category');
  }

  console.info(
    `Synthetic seed verified: ${caseCount} cases and ${runCount} analysis runs across ${categoryCounts.length} categories`,
  );
} finally {
  await prisma.$disconnect();
}
