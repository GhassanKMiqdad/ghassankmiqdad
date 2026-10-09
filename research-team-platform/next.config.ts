import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
// Only force HTTPS when the backend is served over HTTPS too; a production
// build run against the local Supabase CLI (http://127.0.0.1:54321) must not
// have its API calls upgraded.
const enforceHttps = !isDev && (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").startsWith("https://");

function supabaseOrigins(): string[] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];
  try {
    const { origin, host, protocol } = new URL(url);
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return [origin, `${wsProtocol}//${host}`];
  } catch {
    return [];
  }
}

// Server Components render on every request (no inline-script nonces), so the
// policy allows inline scripts and styles but still blocks foreign origins,
// framing, plugins and form posts to other sites.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigins().join(" ")}${isDev ? " ws: wss:" : ""}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(enforceHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  ...(enforceHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // /workspace is the canonical home of NestHire Workspace; older links keep working.
  // (Redirects only change the URL: every page still checks the session and RLS.)
  async redirects() {
    return [
      { source: "/dashboard", destination: "/workspace", permanent: true },
      { source: "/nesthire", destination: "/workspace", permanent: true },
      { source: "/nesthire/:path*", destination: "/workspace", permanent: true },
    ];
  },
};

export default nextConfig;
