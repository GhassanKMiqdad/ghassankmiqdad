import { describe, expect, it } from "vitest";

import { validateSupabaseDbUrl } from "../../scripts/ci/validate-supabase-db-url.mjs";

// Fake values only. The validator must never need a real secret to be tested.
const REF = "jkvxhxrclfvoxqcniyck";
const OLD_REF = "vqorfahkecswjrqgizhy";
const HOST = "aws-1-eu-central-1.pooler.supabase.com";
const PASSWORD = "Fake-Test-Password-123";
const good = (overrides: Partial<Record<"scheme" | "user" | "password" | "host" | "port" | "tail", string>> = {}) => {
  const o = {
    scheme: "postgresql",
    user: `postgres.${REF}`,
    password: PASSWORD,
    host: HOST,
    port: "5432",
    tail: "/postgres",
    ...overrides,
  };
  return `${o.scheme}://${o.user}:${o.password}@${o.host}:${o.port}${o.tail}`;
};

const code = (value: unknown, ref = REF) => {
  const result = validateSupabaseDbUrl(value, ref);
  return result.ok ? "OK" : result.code;
};

describe("validateSupabaseDbUrl", () => {
  it("accepts the Session Pooler URL of the expected project", () => {
    expect(code(good())).toBe("OK");
    expect(code(good({ scheme: "postgres" }))).toBe("OK");
    expect(code(good({ host: "aws-0-us-east-1.pooler.supabase.com" }))).toBe("OK");
    expect(code(good({ tail: "/postgres?sslmode=require" }))).toBe("OK");
    expect(code(good({ password: "p%40ss%2Fw%3Ard" }))).toBe("OK");
  });

  it("rejects a missing or empty value", () => {
    expect(code(undefined)).toBe("MISSING");
    expect(code("")).toBe("MISSING");
    expect(code(null)).toBe("MISSING");
  });

  it("rejects a wrong or forbidden expected project ref", () => {
    expect(code(good(), "")).toBe("EXPECTED_REF_INVALID");
    expect(code(good(), "JKVXHXRCLFVOXQCNIYCK")).toBe("EXPECTED_REF_INVALID");
    expect(code(good(), OLD_REF)).toBe("EXPECTED_REF_FORBIDDEN");
  });

  it("rejects the old project anywhere in the value", () => {
    expect(code(good({ user: `postgres.${OLD_REF}` }))).toBe("FORBIDDEN_PROJECT");
    expect(code(`postgresql://postgres:${PASSWORD}@db.${OLD_REF}.supabase.co:5432/postgres`)).toBe("FORBIDDEN_PROJECT");
  });

  it("rejects a user for another project or the bare postgres user", () => {
    expect(code(good({ user: "postgres.abcdefghijabcdefghij" }))).toBe("USER");
    expect(code(good({ user: "postgres" }))).toBe("USER");
    expect(code(good({ user: `postgres.${REF}x` }))).toBe("USER");
    expect(code(good({ user: `Postgres.${REF}` }))).toBe("USER");
  });

  it("rejects a missing password", () => {
    expect(code(`postgresql://postgres.${REF}@${HOST}:5432/postgres`)).toBe("PASSWORD_MISSING");
    expect(code(good({ password: "" }))).toBe("PASSWORD_MISSING");
    expect(code(`postgresql://${HOST}:5432/postgres`)).toBe("CREDENTIALS_MISSING");
  });

  it("rejects malformed percent-encoding and unencoded delimiters", () => {
    expect(code(good({ password: "bad%zzencoding" }))).toBe("ENCODING");
    expect(code(good({ password: "bad%0Acontrol" }))).toBe("ENCODING");
    expect(code(good({ password: "p@ss" }))).toBe("CREDENTIALS_NOT_ENCODED");
    expect(code(good({ password: "p?ss" }))).not.toBe("OK");
    expect(code(good({ password: "p#ss" }))).not.toBe("OK");
  });

  it("rejects the direct database host (Session Pooler required)", () => {
    expect(code(good({ host: `db.${REF}.supabase.co` }))).toBe("DIRECT_HOST_NOT_ALLOWED");
  });

  it("rejects wrong ports, including the transaction pooler", () => {
    expect(code(good({ port: "6543" }))).toBe("PORT");
    expect(code(good({ port: "05432" }))).toBe("PORT");
    expect(code(`postgresql://postgres.${REF}:${PASSWORD}@${HOST}/postgres`)).toBe("HOST_PORT");
  });

  it("rejects look-alike, bracketed, IP and multi-host values", () => {
    for (const host of [
      "aws-1-eu-central-1.pooler.supabase.com.evil.example",
      "aws-1-eu-central-1.pooler.supabase.co",
      "aws-1-eu-central-1-pooler.supabase.com",
      "pooler.supabase.com",
      "evil-pooler.example.com",
      "AWS-1-EU-CENTRAL-1.POOLER.SUPABASE.COM",
      "aws-1-eu-central-1.pooler.supabase.com.",
      "127.0.0.1",
      "localhost",
    ]) {
      expect(code(good({ host })), host).toBe("HOST_NOT_SESSION_POOLER");
    }
    expect(code(good({ host: "[::1]" }))).toBe("ILLEGAL_CHARACTERS");
    expect(code(good({ host: "аws-1-eu-central-1.pooler.supabase.com" }))).toBe("ILLEGAL_CHARACTERS");
    expect(code(`postgresql://postgres.${REF}:${PASSWORD}@${HOST}:5432,evil.example:5432/postgres`)).toBe("HOST_PORT");
    expect(code(`postgresql://postgres.${REF}:${PASSWORD}@evil.example@${HOST}:5432/postgres`)).toBe(
      "CREDENTIALS_NOT_ENCODED",
    );
    expect(code(`postgresql://postgres.${REF}:${PASSWORD}@${HOST}\\@evil.example:5432/postgres`)).toBe(
      "ILLEGAL_CHARACTERS",
    );
  });

  it("rejects a wrong database name", () => {
    expect(code(good({ tail: "/template1" }))).toBe("DATABASE");
    expect(code(good({ tail: "/postgres/extra" }))).toBe("DATABASE");
    expect(code(good({ tail: "/" }))).toBe("DATABASE");
    expect(code(good({ tail: "" }))).not.toBe("OK");
  });

  it("rejects libpq connection overrides in the query string", () => {
    for (const tail of [
      "/postgres?host=evil.example",
      "/postgres?port=6543",
      "/postgres?dbname=template1",
      "/postgres?user=postgres",
      "/postgres?sslmode=disable",
      "/postgres?sslmode=require&host=evil.example",
      "/postgres?options=-csearch_path%3Devil",
    ]) {
      expect(code(good({ tail })), tail).toBe("QUERY_NOT_ALLOWED");
    }
  });

  it("rejects wrong schemes, whitespace and fragments", () => {
    expect(code(good({ scheme: "https" }))).toBe("SCHEME");
    expect(code(good({ scheme: "POSTGRESQL" }))).toBe("SCHEME");
    expect(code(` ${good()}`)).toBe("ILLEGAL_CHARACTERS");
    expect(code(`${good()}\n`)).toBe("ILLEGAL_CHARACTERS");
    expect(code(`${good()}#frag`)).toBe("DATABASE");
  });

  it("never echoes the value in its result", () => {
    const result = validateSupabaseDbUrl(good({ port: "6543" }), REF);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });
});

describe("validator hints", () => {
  it("documents a remediation for every code the validator can return", async () => {
    const { HINTS } = await import("../../scripts/ci/validate-supabase-db-url.mjs");
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../scripts/ci/validate-supabase-db-url.mjs", import.meta.url), "utf8"),
    );
    const codes = new Set([...source.matchAll(/fail\("([A-Z_]+)"\)/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(10);
    for (const c of codes) expect(HINTS[c], c).toBeTruthy();
  });

  it("rejects a bracketed pooler host (the 2026-10-11 secret defect) with a host hint", async () => {
    const { HINTS } = await import("../../scripts/ci/validate-supabase-db-url.mjs");
    expect(
      code(`postgresql://postgres.${REF}:${PASSWORD}@[aws-0-ap-southeast-1.pooler.supabase.com]:5432/postgres`),
    ).toBe("ILLEGAL_CHARACTERS");
    expect(HINTS.ILLEGAL_CHARACTERS).toContain("around the host");
  });

  it("explains the dashboard template mistake without echoing the value", () => {
    const value = `postgresql://postgres.${REF}:[${PASSWORD}]@${HOST}:5432/postgres`;
    expect(code(value)).toBe("ILLEGAL_CHARACTERS");
  });
});
