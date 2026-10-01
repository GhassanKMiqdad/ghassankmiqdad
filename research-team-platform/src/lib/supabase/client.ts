"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

let browserClient: SupabaseClient<Database> | null = null;

/**
 * Session-less browser client (anon key only). It is used solely to upload a
 * file to a server-issued signed upload URL: the URL's token carries the
 * authorization, and the auth cookies stay HTTP-only and out of reach of page
 * scripts. All data reads and writes go through Server Components and Server
 * Actions.
 */
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }
  return browserClient;
}
