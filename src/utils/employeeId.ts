import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Atomically allocates the next Employee ID (EMP001, EMP002, ...).
 *
 * Uses a single-row counter table updated with a raw atomic UPDATE
 * (`lastSeq = lastSeq + 1 RETURNING lastSeq`), which Postgres serializes
 * per-row — so two concurrent approvals can never be handed the same
 * number, without needing SELECT ... FOR UPDATE plumbing in Prisma.
 * Must be called from inside a Prisma `$transaction`.
 */
export async function nextEmployeeId(
  tx: Prisma.TransactionClient | PrismaClient,
): Promise<string> {
  // Ensure the singleton counter row exists.
  await tx.$executeRaw`INSERT INTO employee_id_counter (id, "lastSeq") VALUES (1, 0) ON CONFLICT (id) DO NOTHING`;

  const rows = await tx.$queryRaw<Array<{ lastSeq: number }>>`
    UPDATE employee_id_counter
    SET "lastSeq" = "lastSeq" + 1
    WHERE id = 1
    RETURNING "lastSeq"
  `;

  const seq = rows[0]?.lastSeq;
  if (seq === undefined) {
    throw new Error('Failed to allocate employee ID sequence');
  }

  return `EMP${String(seq).padStart(3, '0')}`;
}
