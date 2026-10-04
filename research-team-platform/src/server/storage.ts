import "server-only";

/** Marker for the Firebase project's configured default Cloud Storage bucket. */
export const DOCUMENT_BUCKET = "default";

/** Short-lived upload/download grants; server-side authorization happens before issuance. */
export const SIGNED_URL_TTL_SECONDS = 120;
