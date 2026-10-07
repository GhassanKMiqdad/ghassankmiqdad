import { z } from "zod";

/**
 * Public configuration (inlined into client bundles at build time).
 * NEXT_PUBLIC_* variables must be referenced literally for Next.js to inline them.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(20),
  FIREBASE_PROJECT_ID: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | null = null;

export function getPublicEnv(): PublicEnv {
  if (cached) return cached;
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  });
  if (!parsed.success) {
    throw new Error(
      "Firebase is not configured: set NEXT_PUBLIC_FIREBASE_API_KEY and FIREBASE_PROJECT_ID (see .env.example).",
    );
  }
  cached = parsed.data;
  return cached;
}

/** Maximum upload size in bytes (keep in sync with the storage bucket limit). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
