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

  console.info('Database connectivity and case persistence checks passed');
} finally {
  if (smokeCaseId !== undefined) {
    await prisma.case.deleteMany({ where: { id: smokeCaseId } });
  }

  await prisma.$disconnect();
}
