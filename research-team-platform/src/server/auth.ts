import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { getPlatformAdminEmails } from "@/lib/env.server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string | null;
};

export type CurrentProfile = {
  id: string;
  email: string | null;
  fullName: string;
  displayName: string;
  isPlatformAdmin: boolean;
  canCreateProjects: boolean;
  createdAt: string;
  lastSignInAt: string | null;
};

/** The authenticated user of this request (JWT verified by Supabase Auth). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Profile of the signed-in user, promoting configured platform admins once. */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_platform_admin, can_create_projects, created_at, last_sign_in_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  let isPlatformAdmin = profile.is_platform_admin;
  let canCreateProjects = profile.can_create_projects;

  if (!isPlatformAdmin && (await bootstrapPlatformAdmin(user))) {
    isPlatformAdmin = true;
    canCreateProjects = true;
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    displayName: profile.full_name.trim() || profile.email || "—",
    isPlatformAdmin,
    canCreateProjects: isPlatformAdmin || canCreateProjects,
    createdAt: profile.created_at,
    lastSignInAt: profile.last_sign_in_at,
  };
});

export async function requireCurrentProfile(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

/**
 * Promotes the user to platform admin when their e-mail is listed in
 * PLATFORM_ADMIN_EMAILS and has been confirmed. Uses the service role because
 * platform flags are not writable by end users.
 */
async function bootstrapPlatformAdmin(user: SessionUser): Promise<boolean> {
  const email = user.email?.toLowerCase();
  if (!email || !getPlatformAdminEmails().includes(email)) return false;

  const admin = createSupabaseAdminClient();
  if (!admin) return false;

  const { data, error } = await admin.auth.admin.getUserById(user.id);
  if (error || !data.user?.email_confirmed_at || data.user.email?.toLowerCase() !== email) return false;

  const { error: rpcError } = await admin.rpc("bootstrap_platform_admin", { p_user_id: user.id });
  if (rpcError) {
    console.error("[auth] platform admin bootstrap failed", rpcError.message);
    return false;
  }
  return true;
}
