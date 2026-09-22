import { createPrismaClient } from '../src/db/prisma.js';
import { createPreviousCasesTool } from '../src/tools/previous-cases.tool.js';
import { PrismaCaseRepository } from '../src/repositories/prisma-case.repository.js';

const EXPECTED_METADATA = {
  previousCaseCount: 2,
  categories: ['harassment', 'safeguarding'],
  hasOpenReview: true,
} as const;

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required for the synthetic tool smoke check');
}

const prisma = createPrismaClient(databaseUrl);

try {
  const tool = createPreviousCasesTool(new PrismaCaseRepository(prisma));
  const metadata = await tool.execute(
    { subjectRef: 'subject_demo_01' },
    { caseId: 'case_tool_smoke_current', subjectRef: 'subject_demo_01' },
  );

  if (JSON.stringify(metadata) !== JSON.stringify(EXPECTED_METADATA)) {
    throw new Error('Synthetic previous-case metadata did not match the expected fixture');
  }

  console.info(
    JSON.stringify({
      status: 'ok',
      tool: tool.definition.name,
      metadata,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      status: 'error',
      error: { code: 'TOOL_SMOKE_CHECK_FAILED' },
    }),
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
