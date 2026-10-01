import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import { getPublicEnv } from "@/lib/env";
import { authCookieOptions } from "@/lib/supabase/cookie-options";
import { auditHeaders } from "@/lib/supabase/request-meta";
import type { Database } from "@/types/database.types";

/**
 * Supabase client acting AS THE SIGNED-IN USER (anon key + session cookie).
 * Every query runs under Row Level Security with that user's JWT, so the
 * database enforces permissions even if application code had a bug.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();

  return createServerClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session on every navigation instead.
        }
      },
    },
    global: {
      // Lets the audit triggers record the end user's IP / user agent.
      headers: auditHeaders(headerStore),
    },
  });
}

export type ServerSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
