import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Admin client — uses the service-role key. This key must NEVER be sent to
 * any frontend; it only ever lives here, on the backend process, and is
 * used for: creating/inviting/deleting Supabase Auth users, and privileged
 * Storage operations (signed upload/download URLs).
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Anon client — used only to verify email+password at login time via
 * `signInWithPassword`. It never persists a session (this backend issues
 * its own access/refresh tokens after verifying the Supabase credentials).
 */
export const supabaseAnon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
