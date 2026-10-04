import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { FieldValue, firebaseAdminAuth, firebaseAdminFirestore } from "@/lib/firebase/admin";
import { getPlatformAdminEmails } from "@/lib/env.server";
import { getFirebaseSession } from "@/lib/firebase/server";

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

function asIso(value: unknown, fallback = new Date().toISOString()): string {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return (value.toDate() as Date).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : fallback;
}

/** The HTTP-only Firebase session cookie is signature- and revocation-checked on every request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getFirebaseSession();
  return session ? { id: session.uid, email: session.email } : null;
});

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Profile of the signed-in user. Platform-admin promotion requires verified email. */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const session = await getFirebaseSession();
  if (!session) return null;

  const db = firebaseAdminFirestore();
  const profileRef = db.collection("profiles").doc(session.uid);
  const snapshot = await profileRef.get();
  let profile = snapshot.data();

  // Self-heal only the non-privileged profile record for accounts created before
  // this migration. Privileged flags are never copied from user-controlled claims.
  if (!profile) {
    const authUser = await firebaseAdminAuth().getUser(session.uid);
    profile = {
      id: authUser.uid,
      email: authUser.email ?? session.email,
      full_name: authUser.displayName ?? "",
      is_platform_admin: false,
      can_create_projects: false,
      created_at: FieldValue.serverTimestamp(),
      last_sign_in_at: FieldValue.serverTimestamp(),
    };
    await profileRef.set(profile, { merge: true });
    profile = (await profileRef.get()).data();
  }

  if (!profile) return null;
  let isPlatformAdmin = profile.is_platform_admin === true;
  let canCreateProjects = profile.can_create_projects === true;

  const email = session.email?.toLowerCase();
  if (!isPlatformAdmin && session.emailVerified && email && getPlatformAdminEmails().includes(email)) {
    await profileRef.set(
      { is_platform_admin: true, can_create_projects: true, updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    );
    isPlatformAdmin = true;
    canCreateProjects = true;
  }

  const fullName = typeof profile.full_name === "string" ? profile.full_name : "";
  const profileEmail = typeof profile.email === "string" ? profile.email : session.email;
  return {
    id: session.uid,
    email: profileEmail,
    fullName,
    displayName: fullName.trim() || profileEmail || "—",
    isPlatformAdmin,
    canCreateProjects: isPlatformAdmin || canCreateProjects,
    createdAt: asIso(profile.created_at),
    lastSignInAt: profile.last_sign_in_at ? asIso(profile.last_sign_in_at) : null,
  };
});

export async function requireCurrentProfile(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}
