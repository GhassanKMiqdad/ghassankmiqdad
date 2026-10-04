import "server-only";

export type IdentityToolkitError = {
  code: string;
  message: string;
  status: number;
};

type IdentityToolkitResult<T> = { data: T; error: null } | { data: null; error: IdentityToolkitError };

function authApiBase() {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
  return emulator
    ? `http://${emulator}/identitytoolkit.googleapis.com/v1`
    : "https://identitytoolkit.googleapis.com/v1";
}

function webApiKey() {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!key) throw new Error("Firebase is not configured: set NEXT_PUBLIC_FIREBASE_API_KEY.");
  return key;
}

export async function identityToolkitRequest<T extends object>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<IdentityToolkitResult<T>> {
  const url = `${authApiBase()}/${endpoint}?key=${encodeURIComponent(webApiKey())}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (response.ok) return { data: result as T, error: null };

  const message = "error" in result ? (result.error?.message ?? "FIREBASE_AUTH_ERROR") : "FIREBASE_AUTH_ERROR";
  return {
    data: null,
    error: { code: message.split(":")[0] ?? "FIREBASE_AUTH_ERROR", message, status: response.status },
  };
}

export function toAuthErrorKey(code: string): string {
  switch (code) {
    case "INVALID_PASSWORD":
    case "EMAIL_NOT_FOUND":
    case "INVALID_LOGIN_CREDENTIALS":
    case "USER_DISABLED":
      return "invalid_credentials";
    case "EMAIL_NOT_VERIFIED":
      return "email_not_confirmed";
    case "EMAIL_EXISTS":
      return "email_exists";
    case "OPERATION_NOT_ALLOWED":
      return "email_provider_disabled";
    case "WEAK_PASSWORD":
      return "weak_password";
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
    case "RESET_PASSWORD_EXCEED_LIMIT":
      return "over_request_rate_limit";
    default:
      return code.toLowerCase();
  }
}
