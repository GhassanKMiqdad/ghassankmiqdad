/**
 * Promotes an existing user to platform admin (system owner).
 *
 *   npm run admin:promote -- owner@university.edu
 *
 * Platform admins may create research projects and manage which other users
 * may create projects (Settings → Platform administration). The change is
 * recorded in the activity log.
 */
import { existsSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database.types";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!email || !email.includes("@")) {
    throw new Error("Usage: npm run admin:promote -- <email>");
  }
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error } = await admin.from("profiles").select("id, email").ilike("email", email).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error(`No user with e-mail ${email}. They must sign up (or be invited) first.`);

  const { error: rpcError } = await admin.rpc("bootstrap_platform_admin", { p_user_id: profile.id });
  if (rpcError) throw new Error(rpcError.message);

  console.log(`✓ ${profile.email} is now a platform admin.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
