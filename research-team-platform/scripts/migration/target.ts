import {
  firebaseAdminApp,
  firebaseAdminAuth,
  firebaseAdminFirestore,
  firebaseAdminStorage,
} from "../../src/lib/firebase/admin";

export type FirebaseTarget = ReturnType<typeof getFirebaseTarget>;

export function getFirebaseTarget(targetProjectId: string) {
  const configuredProjectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (configuredProjectId && configuredProjectId !== targetProjectId) {
    throw new Error(
      "FIREBASE_PROJECT_ID must match FIREBASE_MIGRATION_PROJECT_ID; refusing cross-project credentials.",
    );
  }
  process.env.FIREBASE_PROJECT_ID = targetProjectId;
  const app = firebaseAdminApp();
  if (app.options.projectId !== targetProjectId) {
    throw new Error("Firebase Admin app project does not match the explicitly requested migration target.");
  }
  return {
    app,
    auth: firebaseAdminAuth(),
    db: firebaseAdminFirestore(),
    bucket: firebaseAdminStorage(),
  };
}

export function normalizeFirestoreValue(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return (value.toDate() as Date).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeFirestoreValue(item)]));
  }
  return value;
}
