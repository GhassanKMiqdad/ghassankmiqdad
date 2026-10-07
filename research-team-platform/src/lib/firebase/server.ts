import "server-only";

import { cookies } from "next/headers";

import { firebaseAdminAuth, firebaseAdminFirestore } from "@/lib/firebase/admin";

export const FIREBASE_SESSION_COOKIE = "research_session";
export const FIREBASE_SESSION_TTL_MS = 5 * 24 * 60 * 60 * 1000;

export type FirebaseSession = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  claims: Record<string, unknown>;
};

export async function getFirebaseSession(): Promise<FirebaseSession | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(FIREBASE_SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    const decoded = await firebaseAdminAuth().verifySessionCookie(value, true);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === "string" ? decoded.email : null,
      emailVerified: decoded.email_verified === true,
      claims: decoded,
    };
  } catch {
    cookieStore.delete(FIREBASE_SESSION_COOKIE);
    return null;
  }
}

/**
 * Server-side Firestore uses the Admin SDK, which bypasses Security Rules.
 * Every query/action must therefore call the shared authorization helpers.
 */
export function getFirebaseFirestore() {
  return firebaseAdminFirestore();
}
