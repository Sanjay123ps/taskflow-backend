import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { startOverdueSyncJob } from './modules/tasks/overdue.service';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`TaskFlow backend listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

// Replaces the old "sync overdue tasks on every GET /tasks" pattern (see
// overdue.service.ts for the full reasoning). Started here rather than in
// app.ts so importing/testing the Express app (createApp) never spins up
// a background timer as a side effect.
const overdueSync = startOverdueSyncJob();

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully...`);
  overdueSync.stop();
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Shutdown complete.');
    process.exit(0);
  });
  // Force-exit if graceful shutdown hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
