import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadEnvironment } from './config/env.js';
import { createPrismaClient } from './db/prisma.js';
import { createLogger } from './logging/logger.js';
import { PrismaCaseRepository } from './repositories/prisma-case.repository.js';

const environment = loadEnvironment();
const logger = createLogger(environment.LOG_LEVEL);
const prisma = createPrismaClient(environment.DATABASE_URL);
const caseRepository = new PrismaCaseRepository(prisma);
const app = createApp({ caseRepository, logger });
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
