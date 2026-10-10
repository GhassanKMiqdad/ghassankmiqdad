import { afterEach, describe, expect, it, vi } from "vitest";
import { getSiteUrl } from "@/lib/env.server";

const original = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  vercelUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
};

afterEach(() => {
  vi.unstubAllEnvs();
  if (original.siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = original.siteUrl;
  if (original.vercelUrl === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = original.vercelUrl;
});

describe("getSiteUrl", () => {
  it("uses the configured production URL instead of a forged forwarded host", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_SITE_URL = "https://team-nesthire.vercel.app/";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "team-nesthire.vercel.app";

    expect(getSiteUrl("https://attacker.example")).toBe("https://team-nesthire.vercel.app");
  });

  it("fails closed in production when the trusted URL is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

    expect(() => getSiteUrl("https://attacker.example")).toThrow("NEXT_PUBLIC_SITE_URL is required in production");
  });

  it("allows a loopback request origin in development, but rejects an external host", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(getSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(getSiteUrl("https://attacker.example")).toBe("http://localhost:3000");
    expect(getSiteUrl("http://127.0.0.1:3001/path")).toBe("http://127.0.0.1:3001");
  });
});
