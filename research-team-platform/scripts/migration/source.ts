import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SourceAuthUser, LegacyRow } from "./mapping";

export const SOURCE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "project-documents";
export const PAGE_SIZE = 500;
const MAX_ROWS = Number(process.env.MIGRATION_MAX_ROWS ?? 50_000);
const MAX_OBJECTS = Number(process.env.MIGRATION_MAX_OBJECTS ?? 100_000);

export type SourceStorageObject = {
  path: string;
  metadata: Record<string, unknown>;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

export function createSourceClient(): SupabaseClient {
  const url = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "research-team-firebase-migration/1.0" } },
  });
}

export async function readTableRows(
  client: SupabaseClient,
  table: string,
  orderBy: string | string[] = "id",
): Promise<LegacyRow[]> {
  const rows: LegacyRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = client.from(table).select("*");
    for (const column of Array.isArray(orderBy) ? orderBy : [orderBy]) {
      query = query.order(column, { ascending: true });
    }
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not read source table ${table}: ${error.message}`);
    const page = (data ?? []) as LegacyRow[];
    rows.push(...page);
    if (rows.length > MAX_ROWS) {
      throw new Error(
        `Source table ${table} exceeds MIGRATION_MAX_ROWS (${MAX_ROWS}); raise the reviewed limit or migrate in a smaller scope.`,
      );
    }
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function readAuthUsers(client: SupabaseClient): Promise<SourceAuthUser[]> {
  const users: SourceAuthUser[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`Could not list Supabase Auth users: ${error.message}`);
    users.push(...(data.users as SourceAuthUser[]));
    if (users.length > MAX_ROWS) {
      throw new Error(
        `Supabase Auth exceeds MIGRATION_MAX_ROWS (${MAX_ROWS}); raise the reviewed limit or migrate in a smaller scope.`,
      );
    }
    if (data.users.length < PAGE_SIZE) return users;
  }
}

function safePathSegment(path: string): string {
  if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe source storage path encountered: ${path || "<empty>"}.`);
  }
  return path;
}

export async function listStorageObjects(
  client: SupabaseClient,
  bucketName = SOURCE_BUCKET,
): Promise<SourceStorageObject[]> {
  const objects: SourceStorageObject[] = [];
  const visited = new Set<string>();
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > 20) throw new Error(`Storage folder nesting exceeds 20 levels below ${folder}.`);
    let offset = 0;
    for (;;) {
      const { data, error } = await client.storage.from(bucketName).list(folder, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Could not list source Storage folder ${folder || "/"}: ${error.message}`);
      const items = data ?? [];
      for (const item of items) {
        if (!item.name || item.name.includes("/")) {
          throw new Error(`Unexpected Storage list entry under ${folder || "/"}.`);
        }
        const path = safePathSegment(folder ? `${folder}/${item.name}` : item.name);
        const isFolder = item.id == null && item.metadata == null;
        if (isFolder) {
          if (!visited.has(path)) {
            visited.add(path);
            await walk(path, depth + 1);
          }
        } else {
          objects.push({ path, metadata: (item.metadata ?? {}) as Record<string, unknown> });
          if (objects.length > MAX_OBJECTS) {
            throw new Error(
              `Source Storage exceeds MIGRATION_MAX_OBJECTS (${MAX_OBJECTS}); raise the reviewed limit or migrate in a smaller scope.`,
            );
          }
        }
      }
      if (items.length < PAGE_SIZE) return;
      offset += items.length;
    }
  };
  await walk("", 0);
  return objects.sort((a, b) => a.path.localeCompare(b.path));
}

export async function downloadSourceObject(
  client: SupabaseClient,
  path: string,
  bucketName = SOURCE_BUCKET,
): Promise<Buffer> {
  const { data, error } = await client.storage.from(bucketName).download(path);
  if (error || !data)
    throw new Error(`Could not download source object ${path}: ${error?.message ?? "empty response"}`);
  return Buffer.from(await data.arrayBuffer());
}
