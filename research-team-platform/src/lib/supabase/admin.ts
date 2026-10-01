import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";
import { getServiceRoleKey } from "@/lib/env.server";
import type { Database } from "@/types/database.types";

/**
 * Service-role client: BYPASSES Row Level Security.
 *
 * Only used for operations that cannot be expressed with the user's own
 * session, and always AFTER the caller was authorized with their own
 * session-bound client:
 *   - inviting a user who has no account yet (auth admin API),
 *   - promoting configured platform admins (PLATFORM_ADMIN_EMAILS),
 *   - removing all stored files of a project the caller just deleted.
 *
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not configured.
 */
export function createSupabaseAdminClient() {
  const serviceRoleKey = getServiceRoleKey();
  if (!serviceRoleKey) return null;
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
