export declare const FORBIDDEN_PROJECT_REFS: readonly string[];

export declare const HINTS: Readonly<Record<string, string>>;

export declare function validateSupabaseDbUrl(
  value: unknown,
  expectedRef: string,
): { ok: true } | { ok: false; code: string };
