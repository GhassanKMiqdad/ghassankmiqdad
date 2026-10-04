import "server-only";

import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { unwrap } from "@/server/action";
import type { PlatformUser } from "@/types/app";

/** All users (visible only to platform admins through RLS). */
export async function listPlatformUsers(): Promise<PlatformUser[]> {
  const firebase = await createFirebaseServerClient();
  const rows = unwrap(
    await firebase
      .from("profiles")
      .select("id, email, full_name, is_platform_admin, can_create_projects, created_at, last_sign_in_at")
      .order("created_at", { ascending: true })
      .limit(1000),
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    isPlatformAdmin: row.is_platform_admin,
    canCreateProjects: row.can_create_projects,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
  }));
}
