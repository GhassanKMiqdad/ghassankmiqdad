import "server-only";

import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function createAdminApp(): App {
  const existing = getApps().find((app) => app.name === "research-platform-admin");
  if (existing) return existing;

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) throw new Error("Firebase is not configured: set FIREBASE_PROJECT_ID.");

  const emulatorMode = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST,
  );
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();

  let credential;
  if (emulatorMode) {
    // Emulators accept unsigned local credentials; no production secrets are needed.
    credential = undefined;
  } else if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain project_id, client_email, and private_key.");
    }
    if (parsed.project_id !== projectId)
      throw new Error("Firebase service account project_id does not match FIREBASE_PROJECT_ID.");
    credential = cert(parsed as Parameters<typeof cert>[0]);
  } else if (clientEmail && privateKey) {
    credential = cert({ projectId, clientEmail, privateKey });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE) {
    credential = applicationDefault();
  } else {
    throw new Error(
      "Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY, or use Google Application Default Credentials.",
    );
  }

  return initializeApp(
    {
      projectId,
      ...(credential ? { credential } : {}),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET?.trim() || `${projectId}.firebasestorage.app`,
    },
    "research-platform-admin",
  );
}

let firestoreInstance: ReturnType<typeof getFirestore> | undefined;

export function firebaseAdminApp(): App {
  return createAdminApp();
}

export function firebaseAdminAuth() {
  return getAuth(createAdminApp());
}

/** Only trusted server code may grant the claim consumed by Firestore/Storage Rules. */
export async function syncPlatformAdminClaim(userId: string, enabled: boolean): Promise<boolean> {
  const auth = firebaseAdminAuth();
  const user = await auth.getUser(userId);
  const claims = { ...(user.customClaims ?? {}) };
  const currentlyEnabled = claims.platform_admin === true;
  if (currentlyEnabled === enabled) return false;
  if (enabled) claims.platform_admin = true;
  else delete claims.platform_admin;
  await auth.setCustomUserClaims(userId, claims);
  return true;
}

export function firebaseAdminFirestore() {
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(createAdminApp());
    firestoreInstance.settings({ ignoreUndefinedProperties: true });
  }
  return firestoreInstance;
}

export function firebaseAdminStorage() {
  return getStorage(createAdminApp()).bucket(
    process.env.FIREBASE_STORAGE_BUCKET?.trim() || `${process.env.FIREBASE_PROJECT_ID?.trim()}.firebasestorage.app`,
  );
}

export { FieldValue };
