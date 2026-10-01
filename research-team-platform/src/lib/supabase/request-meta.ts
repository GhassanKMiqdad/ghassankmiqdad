/**
 * Extracts the end-user IP address and user agent from incoming request
 * headers. On Vercel `x-forwarded-for` / `x-real-ip` are set by the platform.
 * Values are only used for the (informational) audit trail.
 */
const IP_PATTERN = /^[0-9a-fA-F:.]{3,45}$/;

export function extractClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim() || "";
  return IP_PATTERN.test(candidate) ? candidate : null;
}

export function extractUserAgent(headers: Headers): string | null {
  const value = headers.get("user-agent");
  if (!value) return null;
  // Header values must stay printable ASCII when forwarded.
  const sanitized = value.replace(/[^\x20-\x7E]/g, "").slice(0, 512);
  return sanitized || null;
}

export function auditHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const ip = extractClientIp(headers);
  const userAgent = extractUserAgent(headers);
  if (ip) result["x-client-ip"] = ip;
  if (userAgent) result["x-client-user-agent"] = userAgent;
  return result;
}
