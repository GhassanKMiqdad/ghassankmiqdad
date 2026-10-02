/**
 * Generates src/types/database.types.ts from a live PostgreSQL schema using
 * @supabase/postgrest-typegen — the same engine that powers
 * `supabase gen types typescript`.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:types
 *
 * Equivalent with the Supabase CLI:
 *   npx supabase gen types typescript --local > src/types/database.types.ts
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.types.ts
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { generateTypescript, sortGeneratorMetadata } from "@supabase/postgrest-typegen/generation";
import { introspect } from "@supabase/postgrest-typegen/introspection";
import { Pool } from "pg";
import prettier from "prettier";

const OUTPUT = path.resolve(import.meta.dirname, "../src/types/database.types.ts");

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error("Set DATABASE_URL (or SUPABASE_DB_URL) to the Postgres connection string.");
  }

  const pool = new Pool({ connectionString });
  try {
    const metadata = await introspect(pool, { includedSchemas: ["public"] });
    const source = await generateTypescript(sortGeneratorMetadata(metadata), {
      postgrestVersion: "12",
      format: (code) => prettier.format(code, { parser: "typescript" }),
    });
    await writeFile(OUTPUT, source, "utf8");
    console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
