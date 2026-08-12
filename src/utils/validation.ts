import { z } from 'zod';

/**
 * Canonical email schema. `Profile.email` is a plain Postgres `text` column
 * with a case-sensitive unique index, so "User@Example.com" and
 * "user@example.com" were previously treated as two different rows even
 * though every other system (mailboxes, Supabase Auth) treats them as the
 * same address. Trimming + lowercasing here — before the `.email()` format
 * check runs — means every schema that uses this instead of a bare
 * `z.string().email()` normalizes to the same value on both writes
 * (signup, staff edits, settings) and lookups (login, OTP, duplicate
 * checks), so they can never silently diverge again.
 */
export const emailSchema = z.string().trim().toLowerCase().email();
