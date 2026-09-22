import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadEnvironment } from './config/env.js';
import { loadLLMEnvironment } from './config/llm-env.js';
import { createPrismaClient } from './db/prisma.js';
import { createLLMClient } from './llm/create-llm-client.js';
import { TRIAGE_PROMPT_VERSION } from './llm/prompts/index.js';
import { createLogger } from './logging/logger.js';
import { PrismaCaseRepository } from './repositories/prisma-case.repository.js';
import { AnalysisService } from './services/analysis.service.js';
import { ReliableAnalysisService } from './services/reliable-analysis.service.js';
import { TriageService } from './services/triage.service.js';
import { createPreviousCasesTool } from './tools/previous-cases.tool.js';
import { ToolRegistry } from './tools/tool-registry.js';

const environment = loadEnvironment();
const llmEnvironment = loadLLMEnvironment();
const logger = createLogger(environment.LOG_LEVEL);
const prisma = createPrismaClient(environment.DATABASE_URL);
const caseRepository = new PrismaCaseRepository(prisma);
const llmClient = createLLMClient({
  provider: llmEnvironment.LLM_PROVIDER,
  model: llmEnvironment.LLM_MODEL,
  apiKey: llmEnvironment.LLM_API_KEY,
});
const toolRegistry = new ToolRegistry([createPreviousCasesTool(caseRepository)]);
const analysisService = new AnalysisService({ llmClient, toolRegistry });
const reliableAnalysisService = new ReliableAnalysisService({
  analysisRunner: analysisService,
  maxRetries: environment.MAX_LLM_RETRIES,
});
const triageService = new TriageService({
  repository: caseRepository,
  reliableAnalyzer: reliableAnalysisService,
  model: llmEnvironment.LLM_MODEL,
  promptVersion: TRIAGE_PROMPT_VERSION,
  reviewPolicy: {
    confidenceThreshold: environment.HUMAN_REVIEW_CONFIDENCE_THRESHOLD,
  },
});
const app = createApp({ caseRepository, logger, triageService });
const server = createServer(app);

server.listen(environment.PORT, () => {
  logger.info({ event: 'server.started', port: environment.PORT });
});

let shuttingDown = false;

async function disconnectDatabase(serverError?: Error): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch {
    logger.error({ event: 'database.disconnect_failed', errorCode: 'DATABASE_DISCONNECT_FAILED' });
    process.exitCode = 1;
  }

  if (serverError !== undefined) {
    logger.error({ event: 'server.stop_failed', errorCode: 'SERVER_STOP_FAILED' });
    process.exitCode = 1;
  }
}

function shutDown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ event: 'server.stopping', signal });

  server.close((serverError) => {
    void disconnectDatabase(serverError);
  });
}

process.once('SIGINT', () => shutDown('SIGINT'));
process.once('SIGTERM', () => shutDown('SIGTERM'));
