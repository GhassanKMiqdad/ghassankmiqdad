#!/usr/bin/env node
// Strict validator for the SUPABASE_DB_URL secret used by the production
// migration workflow (.github/workflows/nesthire-supabase-production.yml).
//
// The secret must be the Supabase *Session Pooler* connection string of the
// NestHire project and nothing else:
//
//   postgresql://postgres.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres
//
// libpq and the WHATWG URL parser do not agree on every edge case (multiple
// hosts, `?host=` overrides, brackets, unencoded `@`), so the checks run on the
// raw string first and the parsed URL second. A value is accepted only when
// both views agree on the same host, port, user and database.
//
// The value is never printed: errors are reported as fixed codes only.
//
// CLI usage (reads environment variables so the secret never appears in argv):
//   SUPABASE_DB_URL=... EXPECTED_PROJECT_REF=jkvxhxrclfvoxqcniyck \
//     node scripts/ci/validate-supabase-db-url.mjs

import { pathToFileURL } from "node:url";

/** Project refs that must never be targeted by NestHire again. */
export const FORBIDDEN_PROJECT_REFS = Object.freeze(["vqorfahkecswjrqgizhy"]);

const PROJECT_REF = /^[a-z]{20}$/;
// aws-0-us-east-1.pooler.supabase.com, aws-1-eu-central-1.pooler.supabase.com, ...
const POOLER_HOST = /^aws-[0-9]{1,2}-[a-z]{2}(?:-[a-z]+)+-[0-9]{1,2}\.pooler\.supabase\.com$/;
const SESSION_POOLER_PORT = "5432";
const DATABASE = "postgres";
const ALLOWED_SSLMODES = new Set(["require", "verify-ca", "verify-full"]);

/**
 * @param {unknown} value the connection string to check
 * @param {string} expectedRef the Supabase project ref it must belong to
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
export function validateSupabaseDbUrl(value, expectedRef) {
  const fail = (code) => ({ ok: false, code });

  if (typeof expectedRef !== "string" || !PROJECT_REF.test(expectedRef)) {
    return fail("EXPECTED_REF_INVALID");
  }
  if (FORBIDDEN_PROJECT_REFS.includes(expectedRef)) return fail("EXPECTED_REF_FORBIDDEN");

  if (typeof value !== "string" || value.length === 0) return fail("MISSING");
  if (value.length > 1024) return fail("TOO_LONG");
  // Whitespace, control characters, non-ASCII (homoglyphs), backslashes and
  // brackets (IPv6 literals) are never part of a valid pooler URL.
  if (!/^[\x21-\x7e]+$/.test(value)) return fail("ILLEGAL_CHARACTERS");
  if (/[\\[\]]/.test(value)) return fail("ILLEGAL_CHARACTERS");

  const lower = value.toLowerCase();
  if (FORBIDDEN_PROJECT_REFS.some((ref) => lower.includes(ref))) return fail("FORBIDDEN_PROJECT");

  // ---- Raw-string view -----------------------------------------------------
  const scheme = /^(postgres|postgresql):\/\//.exec(value);
  if (!scheme) return fail("SCHEME");
  const rest = value.slice(scheme[0].length);

  const slash = rest.indexOf("/");
  if (slash === -1) return fail("DATABASE");
  const authority = rest.slice(0, slash);
  const pathAndQuery = rest.slice(slash);

  const at = authority.lastIndexOf("@");
  if (at === -1) return fail("CREDENTIALS_MISSING");
  const userinfo = authority.slice(0, at);
  const hostport = authority.slice(at + 1);

  if (userinfo.includes("@")) return fail("CREDENTIALS_NOT_ENCODED");
  const colon = userinfo.indexOf(":");
  if (colon === -1) return fail("PASSWORD_MISSING");
  const rawUser = userinfo.slice(0, colon);
  const rawPassword = userinfo.slice(colon + 1);
  if (rawPassword.length === 0) return fail("PASSWORD_MISSING");
  if (/[/?#]/.test(rawPassword)) return fail("CREDENTIALS_NOT_ENCODED");

  let user;
  let password;
  try {
    user = decodeURIComponent(rawUser);
    password = decodeURIComponent(rawPassword);
  } catch {
    return fail("ENCODING");
  }
  if (password.length === 0) return fail("PASSWORD_MISSING");
  if (/[\x00-\x1f\x7f]/.test(password)) return fail("ENCODING");
  if (user !== `postgres.${expectedRef}`) return fail("USER");

  // Exactly one host, an explicit Session Pooler port, no multi-host lists.
  const hp = /^([^:,]+):([0-9]+)$/.exec(hostport);
  if (!hp) return fail("HOST_PORT");
  const [, host, port] = hp;
  if (/^db\.[a-z]{20}\.supabase\.co$/.test(host)) return fail("DIRECT_HOST_NOT_ALLOWED");
  if (!POOLER_HOST.test(host)) return fail("HOST_NOT_SESSION_POOLER");
  if (port !== SESSION_POOLER_PORT) return fail("PORT");

  const pq = /^\/([^?#]*)(?:\?([^#]*))?$/.exec(pathAndQuery);
  if (!pq) return fail("DATABASE");
  if (pq[1] !== DATABASE) return fail("DATABASE");
  if (pq[2] !== undefined) {
    // libpq honours connection keywords in the query string (host=, port=,
    // user=, dbname=, ...), which would silently override everything above.
    const params = pq[2].split("&");
    for (const param of params) {
      const m = /^([a-z]+)=([a-z-]+)$/.exec(param);
      if (!m || m[1] !== "sslmode" || !ALLOWED_SSLMODES.has(m[2])) return fail("QUERY_NOT_ALLOWED");
    }
    if (params.length > 1) return fail("QUERY_NOT_ALLOWED");
  }

  // ---- Parsed view: must agree with the raw view ----------------------------
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return fail("UNPARSEABLE");
  }
  if (
    parsed.hostname !== host ||
    parsed.port !== port ||
    parsed.username !== rawUser ||
    parsed.password !== rawPassword ||
    parsed.pathname !== `/${DATABASE}` ||
    parsed.hash !== ""
  ) {
    return fail("PARSER_MISMATCH");
  }

  return { ok: true };
}

/** Owner-facing remediation for each code. Never includes the value itself. */
export const HINTS = Object.freeze({
  MISSING: "Set the SUPABASE_DB_URL secret (Supabase -> Connect -> Session pooler URI).",
  TOO_LONG: "The value is longer than any Session Pooler URI; paste only the URI.",
  ILLEGAL_CHARACTERS:
    "Remove spaces/newlines and the [ ] brackets around the password from the dashboard template; percent-encode special characters in the password.",
  FORBIDDEN_PROJECT: "The value points at the retired project; use the jkvxhxrclfvoxqcniyck Session Pooler URI.",
  SCHEME: "The URI must start with postgresql:// (lower case).",
  DATABASE: "The URI must end with /postgres (optionally ?sslmode=require).",
  CREDENTIALS_MISSING: "Include user and password: postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres",
  CREDENTIALS_NOT_ENCODED:
    "Percent-encode @ / ? # : in the password (for example @ -> %40), or reset it to an alphanumeric password.",
  PASSWORD_MISSING: "The password part is empty; replace [YOUR-PASSWORD] with the database password.",
  ENCODING: "The password contains invalid percent-encoding or control characters.",
  USER: "The user must be exactly postgres.<project-ref> of the intended project (Session Pooler format).",
  HOST_PORT: "Use exactly one host followed by :5432.",
  DIRECT_HOST_NOT_ALLOWED:
    "Use the Session Pooler host (aws-N-<region>.pooler.supabase.com), not db.<ref>.supabase.co.",
  HOST_NOT_SESSION_POOLER: "The host must be the Supabase Session Pooler host aws-N-<region>.pooler.supabase.com.",
  PORT: "Use the Session Pooler port 5432 (6543 is the transaction pooler).",
  QUERY_NOT_ALLOWED: "Remove query parameters; only ?sslmode=require|verify-ca|verify-full is accepted.",
  PARSER_MISMATCH: "The URI parses ambiguously; percent-encode special characters in the password.",
  UNPARSEABLE: "The URI cannot be parsed; percent-encode special characters in the password.",
  EXPECTED_REF_INVALID: "EXPECTED_PROJECT_REF must be a 20-letter Supabase project ref.",
  EXPECTED_REF_FORBIDDEN: "EXPECTED_PROJECT_REF names the retired project.",
});

function main() {
  const result = validateSupabaseDbUrl(process.env.SUPABASE_DB_URL, process.env.EXPECTED_PROJECT_REF);
  if (result.ok) {
    console.log("SUPABASE_DB_URL validated: Session Pooler, expected project, user and database.");
    return 0;
  }
  console.error(`SUPABASE_DB_URL rejected: ${result.code}. ${HINTS[result.code] ?? ""}`.trim());
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
