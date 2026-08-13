import { PrismaClient } from '@prisma/client';
import { isProd } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Reuse a single PrismaClient across hot reloads in dev to avoid exhausting
// the Supabase connection pool.
export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: isProd ? ['error', 'warn'] : ['error', 'warn'],
  });

if (!isProd) {
  global.__prisma = prisma;
}
