# NestHire database readiness

Target: Supabase project **`jkvxhxrclfvoxqcniyck`** ("NestHire Production", region
ap-southeast-1, PostgreSQL 17, status `ACTIVE_HEALTHY` on 2026-10-11).
The retired project `vqorfahkecswjrqgizhy` must never be targeted again; the migration
workflow and its URL validator reject it.

This document contains no secrets. Connection strings, passwords and keys stay in
GitHub/Vercel/Supabase secret stores.

## 1. Current status (2026-10-11 05:40 UTC)

| Item                          | Status                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Repository migrations         | 20 files, `supabase/migrations/`                                                                    |
| Recorded in production ledger | 7 of 20 (0100–0600 and 20261010000200), plus 5 manual entries kept as history                       |
| Pending on production         | **13** (20261001000700 → 20261010000100)                                                            |
| Production objects            | 10 public tables, 34 functions, 16 triggers, 0 RLS policies, 0 storage buckets                      |
| Reference data                | 24 permissions, 60 role-permission rows (57 after the pending migrations)                           |
| Users / business data         | 0 auth users, 0 profiles, 0 projects, 0 tasks                                                       |
| Recovery snapshot             | schema `nesthire_recovery_20261011` (catalog, role templates, original ledger, original constraint) |

**Production is in a safe, consistent intermediate state.** RLS is enabled on every
public table and there are no policies yet, so the API denies all row access (fail
closed). Only `public.create_project` from migration 0700 already exists; it was created
early during a retry, then restricted to `authenticated`/`service_role`, and it refuses
callers without `can_create_projects` (no user has it).

**Why it stopped:** the Supabase MCP connection holds any statement that changes roles
(e.g. `update project_members set role = 'owner'` inside `transfer_project_ownership`) for
interactive owner confirmation. That confirmation timed out because nobody was present to
approve it. Rewriting the migration to avoid the check would mean circumventing a safety
control, so the remainder is packaged for the owner instead (section 4).

## 2. Reconciliation history

Before (2026-10-10, previous audit):

- Ledger: 5 manual MCP entries (`20261010074921 core_schema`, `…074946 core_schema_regex_fix`,
  `…075001 core_schema_regex_fix_v2`, `…075008 permission_catalog`,
  `…075040 revoke_rls_auto_enable_execute`) and no repository versions.
- Schema: core tables from 0100 and the catalog from 0200 existed, with two defects:
  `activity_logs_action_format` held a double backslash (`'^[a-z_]+\\.[a-z_]+$'`), which
  would have rejected **every** audit insert, and one permission description differed.
- No helper functions, triggers, RPCs, policies, Storage bucket or Storage policies.

Decisions, each proven before any write:

1. 0100 and 0200 were compared object-by-object with a fresh build; apart from the two
   defects they were equivalent, so they were **recorded, not replayed**.
2. 20261010000200 was already effective (identical SQL in the manual entry), so it was
   recorded too.
3. The 5 manual entries are **kept**. They are real history; deleting them would hide how
   the database was built. They are not repository versions, so `supabase db push` will
   report them as remote-only (see section 6).
4. Every remaining migration is applied verbatim (top-level comments removed), one guarded
   transaction per migration. A guard refuses to run unless the previous version is
   recorded and this one is not, so the procedure cannot run out of order or twice.

Part 1 (applied through MCP, 2026-10-11): snapshot into `nesthire_recovery_20261011`,
constraint and description repair, ledger rows for 0100/0200/20261010000200, then
migrations 0300, 0400, 0500, 0600 (each verified after commit).

Part 2 (pending, owner-run): `scripts/sql/reconcile/2026-10-11-jkvxhxrclfvoxqcniyck-apply-0700-to-1010000100.sql`.

Machine-readable status with SHA-256 of every migration:
[`docs/migration-reconciliation-manifest.json`](migration-reconciliation-manifest.json).

## 3. Evidence that part 2 is correct

Rehearsed on a local PostgreSQL replica rebuilt in **exactly** the production state
(same ledger rows, same early `create_project` and revoke):

| Check                                                                       | Result                                                                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Part-2 script, `psql -v ON_ERROR_STOP=1`                                    | exit 0, ledger 25 rows                                                                                                                              |
| Second run                                                                  | stops at the first guard, no change (fingerprint unchanged)                                                                                         |
| 13-dimension fingerprint vs fresh build of all migrations                   | identical                                                                                                                                           |
| Same fingerprint vs the official local Supabase stack (`supabase db reset`) | identical                                                                                                                                           |
| pgTAP suite (11 files, 389 assertions) on the reconciled replica            | all pass                                                                                                                                            |
| Chunk bodies vs repository files                                            | 12/13 byte-identical after comment stripping; 20261008000100 differs only by two comment lines inside a policy expression (comments are not stored) |

Fingerprint dimensions: functions (incl. body hash, `SECURITY DEFINER`, `search_path`),
function ACLs, policies, constraints, triggers, columns, indexes, table grants, column
grants, RLS flags, Storage buckets, permission catalog, role templates.
Query: `scripts/sql/reconcile/schema-fingerprint.sql`. Expected values: manifest
`expected_fingerprint_after_part2`.

## 4. Owner procedure to finish production (≈2 minutes)

Prerequisite: ledger still at 12 rows and 20261001000700 absent:

```sql
select count(*) as rows,
       bool_or(version = '20261001000700') as has_0700
from supabase_migrations.schema_migrations;   -- expect 12, false
```

Then choose **one**:

- **A. SQL editor (recommended).** Supabase Dashboard → project `jkvxhxrclfvoxqcniyck` →
  SQL Editor → paste the whole part-2 file → Run. Each migration commits on its own; on
  any error the run stops and earlier migrations stay applied. Re-check the ledger and
  paste from the next `-- ===== NN_` section.
- **B. Ask Claude to continue** while you are present to approve the Supabase
  confirmation prompts.
- **C. GitHub Actions** (`NestHire Supabase Production Migration`) after section 6 is
  resolved.

Afterwards verify:

```sql
select count(*) from supabase_migrations.schema_migrations;  -- expect 25
```

Then run `scripts/sql/reconcile/schema-fingerprint.sql` and compare every row with the
manifest. Run the Supabase security advisor; the "RLS enabled, no policy" notices must
disappear.

## 5. Intended schema and authorization model

18 public tables, all with RLS. Writes go through `SECURITY DEFINER` RPCs or guarded
triggers in schema `private` (all with `search_path = ''`); table grants are column-level
where direct writes are allowed.

| Table                                             | Policies (authenticated only)                                                    | Notes                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| profiles                                          | select (self, co-members, platform admin), update self (`full_name` column only) | email/admin flags not client-writable                                      |
| projects                                          | select (`project.view`), update (`project.edit`), delete (`project.delete`)      | create via `create_project` RPC                                            |
| project_members                                   | select (self, `team.view`, `tasks.assign`)                                       | changes only via member RPCs with rank checks                              |
| permissions, role_permissions                     | select                                                                           | reference data                                                             |
| user_permissions                                  | select (self, `team.view`)                                                       | `set_member_permissions` blocks self-escalation                            |
| tasks                                             | select/insert/update/delete per `tasks.*` permissions                            | trigger enforces field-level rules and workflow                            |
| task_dependencies                                 | select/insert/delete                                                             |                                                                            |
| task_submissions, task_reviews, task_publications | select                                                                           | writes via workflow RPCs; manager self-review exception per 20261010000100 |
| documents                                         | select/insert/update/delete per `documents.*`                                    | metadata bound to the Storage object                                       |
| comments                                          | select/insert/update/delete                                                      | author spoofing blocked by trigger                                         |
| notifications                                     | select/update/delete own                                                         |                                                                            |
| teams, team_members, team_member_invites          | select                                                                           | writes via team RPCs                                                       |
| activity_logs                                     | select (`activity.view`, own actions, platform admin for orphaned rows)          | append-only via `private.log_activity`                                     |

Storage: one **private** bucket `project-documents` (50 MB limit, allow-listed document,
spreadsheet, archive and image MIME types) with select/insert/delete policies keyed to the
project in the object path and the `documents.*` permissions. Downloads use short-lived
signed URLs created on the server after an authorization check.

Detailed matrix: [PERMISSIONS.md](PERMISSIONS.md), [SECURITY.md](SECURITY.md),
[SECURITY-DEFINER-REVIEW.md](SECURITY-DEFINER-REVIEW.md).

## 6. Migration history and `supabase db push`

After part 2, the ledger holds all 20 repository versions plus the 5 manual entries.
`supabase db push` (including the hardened workflow's dry-run) will then stop with
"remote migration versions not found locally". That is intended: the workflow never
repairs history on its own. The documented, owner-approved way to resolve it, keeping
evidence:

1. The original 5 rows are preserved in `nesthire_recovery_20261011.schema_migrations`
   (and in the manifest).
2. Mark them as reverted in the CLI's view:
   `supabase migration repair --status reverted 20261010074921 20261010074946 20261010075001 20261010075008 20261010075040 --db-url "$SUPABASE_DB_URL"`
   This removes those 5 ledger rows only; it does not touch schema or data, and the copy
   in the recovery schema remains.

Do not run this before part 2 is complete and the fingerprint matches.

## 7. Seed and initial data

- `scripts/seed.ts` is for **local/CI only** (fictional demo accounts). Never run it
  against production.
- First administrator: sign up through the app, then run
  `select public.bootstrap_platform_admin('<user uuid>');` as the service role (SQL
  editor), or `npm run admin:promote` with server-side credentials. The RPC refuses
  `anon`/`authenticated` callers.
- The real month-1 plan (roster, 66 tasks, 90 dependencies) is not stored in this public
  repository. It is loaded after the Director account exists in production.

## 8. Backup and recovery

| Item                                   | Status                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery snapshot of pre-existing data | in-database schema `nesthire_recovery_20261011` (no user data existed)                                                                                                  |
| Rebuildability                         | the complete schema is reproducible from the repository migrations (proven by fingerprint)                                                                              |
| Supabase daily backups / PITR          | **NOT VERIFIED.** No dashboard/billing access from the tools used. Owner: Dashboard → Database → Backups; PITR is a paid add-on, so do not enable it without a decision |
| Restore drill                          | NOT PERFORMED on the platform; local rebuild drill passed                                                                                                               |

Restore procedure (schema-level) if part 2 ever needs to be undone before real data
exists: create a fresh project, apply all repository migrations in order with
`supabase db push` against it, and verify the fingerprint. With real data present, use
the Supabase backup restore (Dashboard) and re-verify.

## 9. Safe maintenance commands

```bash
# Local, isolated: full pgTAP suite on plain PostgreSQL
npm run test:db:local
# Local Supabase stack
npx supabase@2.119.0 start && npx supabase@2.119.0 db reset && npx supabase@2.119.0 test db
# API attack suite against the local stack
npm run test:integration
# Production: only through the gated workflow (dry-run first)
#   GitHub → Actions → "NestHire Supabase Production Migration" → mode=dry-run
```

Never run `supabase db reset`, `--include-seed`, or `npm run seed` against production.
