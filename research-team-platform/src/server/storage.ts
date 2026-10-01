import "server-only";

/** Private bucket created by supabase/migrations/*_storage.sql. */
export const DOCUMENT_BUCKET = "project-documents";

/** Lifetime of signed download / view URLs, in seconds. */
export const SIGNED_URL_TTL_SECONDS = 60;
