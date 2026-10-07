import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { PERMISSION_KEYS, ROLE_TEMPLATES, TEAM_LEAD_PERMISSIONS } from "@/lib/permissions/catalog";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../supabase/migrations");
const sql = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATIONS, file), "utf8"))
  .join("\n");
const catalogSql = readFileSync(
  path.join(
    MIGRATIONS,
    readdirSync(MIGRATIONS).find((file) => file.includes("permission_catalog"))!,
  ),
  "utf8",
);

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key));
}

describe("database ↔ application consistency", () => {
  it("the TypeScript permission catalog matches the SQL catalog (same keys, same order)", () => {
    const block = catalogSql.slice(
      catalogSql.indexOf("insert into public.permissions"),
      catalogSql.indexOf("on conflict (key)"),
    );
    const sqlKeys = [...block.matchAll(/\('([a-z_]+\.[a-z_]+)'/g)].map((match) => match[1]);
    expect(sqlKeys).toEqual([...PERMISSION_KEYS]);
  });

  it.each(["manager", "member", "reviewer"] as const)("the %s role template matches the SQL template", (role) => {
    const start = catalogSql.indexOf(`select '${role}'::public.project_role`);
    const end = catalogSql.indexOf("]) as k", start);
    const sqlKeys = new Set(
      [...catalogSql.slice(start, end).matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((match) => match[1]),
    );
    // Later migrations may remove keys from a template.
    const removal = new RegExp(
      `delete from public\\.role_permissions\\s+where role = '${role}'\\s+and permission_key in \\(([^)]*)\\)`,
      "g",
    );
    for (const match of sql.matchAll(removal)) {
      for (const key of match[1]!.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) sqlKeys.delete(key[1]);
    }
    expect(sqlKeys).toEqual(new Set(ROLE_TEMPLATES[role]));
  });

  it("the Team Lead permission set matches private.team_lead_permissions()", () => {
    const start = sql.indexOf("function private.team_lead_permissions()");
    const end = sql.indexOf("]::text[]", start);
    const sqlKeys = [...sql.slice(start, end).matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((match) => match[1]);
    expect(new Set(sqlKeys)).toEqual(new Set(TEAM_LEAD_PERMISSIONS));
  });

  it("every error code raised by the database has a translated message", () => {
    const codes = new Set([...sql.matchAll(/message = '([A-Z_]+)'/g)].map((match) => match[1]!));
    expect(codes.size).toBeGreaterThan(10);
    for (const code of codes) {
      expect(en.errors, `en.errors.${code}`).toHaveProperty(code);
      expect(ar.errors, `ar.errors.${code}`).toHaveProperty(code);
    }
  });

  it("every audit action written by the database has a sentence in both languages", () => {
    const actions = new Set(
      [...sql.matchAll(/'((?:project|task|document|comment|member|permissions|platform_user|team)\.[a-z_]+)'/g)]
        .map((match) => match[1]!)
        .filter((action) => !PERMISSION_KEYS.includes(action as never)),
    );
    expect(actions.size).toBeGreaterThanOrEqual(15);
    for (const action of actions) {
      expect(en.activity.actions, `en.activity.actions.${action}`).toHaveProperty([action]);
      expect(ar.activity.actions, `ar.activity.actions.${action}`).toHaveProperty([action]);
    }
  });

  it("Arabic and English dictionaries expose exactly the same keys", () => {
    expect(keysOf(ar).sort()).toEqual(keysOf(en).sort());
  });

  it("the security messages required by the specification exist in Arabic", () => {
    expect(ar.errors.PERMISSION_DENIED).toBe("ليس لديك صلاحية لتنفيذ هذه العملية.");
    expect(ar.errors.TASK_EDIT_FORBIDDEN).toBe("لا يمكنك تعديل هذه المهمة.");
    expect(ar.errors.PROJECT_ACCESS_DENIED).toBe("لا يمكنك الوصول إلى هذا المشروع.");
  });
});
