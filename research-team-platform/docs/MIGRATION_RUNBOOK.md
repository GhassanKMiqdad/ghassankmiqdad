# Supabase-to-Firebase data migration runbook

## Scope and safety boundary

This repository contains an offline planner and an **optional local Firestore Emulator-only** apply adapter. It has not been run against production data. No production migration, Firebase production connection, Supabase connection, Auth import, or Storage copy is performed by this subsystem. The normal command is a dry run; it reads one local JSON/JSONL export and writes a report only when asked. **Do not treat these scripts as authorization to cut over production.**

The explicit apply command is deliberately narrower than a general staging migrator: it accepts only a Firebase project ID matching `demo-*` and requires `FIRESTORE_EMULATOR_HOST` to be `localhost`, `127.0.0.1`, or `[::1]`. Production/named project IDs and non-loopback Firestore hosts are rejected before an Admin SDK instance is created. It does not load Google credentials. Do not weaken this guard as part of a production cutover; a separately reviewed staging adapter, deployment approvals, security review and rollback plan would be required first.

All examples use fictional/test exports. Keep real exports, reports, checkpoints, credentials, and object files outside Git; restrict access because the input and imported records may contain personal data. The test fixture under `tests/migration/fixtures/` is synthetic and must never be replaced with a real export.

## Prerequisites and commands

- Node.js 20.9+ (Node 22 recommended), npm, and this repository's installed dependencies.
- For emulator apply only: Java 21+ and Firebase Emulator Suite.
- No Supabase/Firebase secret is used by the dry-run validator. No network access is needed for dry run.

```bash
npm ci
npm run test:migration

# Validation-only by default. The report contains counts and issues, not source rows.
node scripts/migration/cli.mjs \
  --input /secure/offline/source-export.json \
  --report /secure/offline/migration-report.json

# Or explicitly select JSONL. .jsonl/.ndjson filename extensions are inferred in auto mode.
node scripts/migration/cli.mjs \
  --input /secure/offline/source-export.jsonl \
  --format jsonl \
  --report /secure/offline/migration-report.json
```

The process exits non-zero if parsing, validation or relationship checks fail. Resolve errors against an independently verified source export, then rerun validation. Do not edit or silently discard rows merely to make the validator pass.

### Accepted input shapes

JSON may be table arrays at its root or nested below `tables`:

```json
{
  "tables": {
    "profiles": [{ "id": "...", "email": "...", "full_name": "..." }],
    "projects": [{ "id": "...", "name": "...", "status": "planning" }]
  }
}
```

JSONL/NDJSON is one object per line, either `{ "table": "profiles", "row": { ... } }` or flat `{ "table": "profiles", "id": "...", ... }`. Supported tables are `profiles`, `projects`, `project_members`, `permissions`, `role_permissions`, `user_permissions`, `tasks`, `documents`, `comments`, and `activity_logs`. Export those source tables as UTF-8 JSON values; unsupported table names and malformed rows are reported rather than imported.

### First-class research entities absent from the legacy source

The retained Supabase migrations define no `teams`, `team_members`, `milestones`, `deliverables`, `submissions`, or `reviews` tables, and the legacy `tasks` table has no team assignment or versioned-submission fields. Those are new Firebase platform capabilities, not historical source records. The importer deliberately rejects unknown tables with `UNKNOWN_TABLE` and makes the validation plan invalid; it does not silently discard an unsupported table or fabricate team memberships, milestones, deliverable requirements, submission versions, or review history. Existing legacy tasks can be imported only in their source shape and remain unassigned to a team. Create new teams and milestones through the application after migration; submission/review history begins when the new workflow is used. If a separate verified source for any of these entities is later identified, design and review an explicit mapping with ownership checks, validation and tests before extending the allowlist or running apply.

## Mapping and normalization

| Supabase source    | Firebase target                                                             | Mapping notes                                                                                                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`         | `profiles/{id}`                                                             | Profile fields are allowlisted. Password/token fields are never copied. `is_platform_admin` and `can_create_projects` are forced to `false`; grant platform privileges later through the audited application workflow. Email is trimmed/lowercased, timestamps are canonical UTC ISO strings. |
| `projects`         | `projects/{id}`                                                             | Stable IDs retained; source defaults normalized for description, goal and status. Creator must resolve to a profile.                                                                                                                                                                          |
| `project_members`  | `project_members/{project_id}_{user_id}`                                    | Membership IDs are recomputed to match the Firebase application's composite-ID convention. Role/status validated; source role template plus explicit grants become a stable `permissions` array.                                                                                              |
| `permissions`      | No standalone collection                                                    | Catalog rows are validated against keys supported by the running Firebase app.                                                                                                                                                                                                                |
| `role_permissions` | `project_members.permissions`                                               | Role defaults are folded into each member's effective permission array.                                                                                                                                                                                                                       |
| `user_permissions` | `user_permissions/{project_id}_{user_id}_{permission_key}` and member array | Stable composite IDs; grants must resolve to a member, project and supported catalog key.                                                                                                                                                                                                     |
| `tasks`            | `tasks/{id}`                                                                | Project, creator and assignee relationships checked; assigned user must belong to the same project. Source status and priority enums validated.                                                                                                                                               |
| `documents`        | `documents/{id}` metadata only                                              | Metadata is mapped and path-checked. Binary Storage objects are **not** copied by this CLI.                                                                                                                                                                                                   |
| `comments`         | `comments/{id}`                                                             | A task comment must point to a task in the same project; project and author references are checked.                                                                                                                                                                                           |
| `activity_logs`    | `activity_logs/{id}`                                                        | Audit fields are allowlisted; project references, action format and entity type are checked.                                                                                                                                                                                                  |

Strings in allowlisted text fields are trimmed; email is lowercased; timestamps normalize to millisecond UTC ISO form; numeric string values for `size_bytes`/`sort_order` become numbers; JSON objects are recursively key-sorted for deterministic comparison. Unknown columns are dropped. Source identity values otherwise remain unchanged. The report contains source/target row counts, input SHA-256, warnings and row/field diagnostics, but no row payloads.

Validation rejects invalid enums/dates/fields, duplicate identities and natural keys, conflicting duplicate IDs, duplicate normalized emails, missing relationships, projects without exactly one owner, unsupported permission keys, invalid document path scope, negative/non-integer byte counts, and path traversal (including encoded dot segments, absolute paths, URL schemes and backslashes). Review all warnings too. `profiles` credential fields can be present in an input; they are omitted and surfaced only as a warning, never written to Firebase.

## Auth: reset and re-invite only

Supabase password hashes and credentials are **never migrated**. The tool does not create Firebase Auth users. Preserve the source profile IDs as intended Firebase UIDs, then use a separately approved, staged invitation workflow to create disabled/unverified Firebase Auth accounts with matching UIDs and verified email ownership; send Firebase verification/invitation and password-reset links so each user establishes a new password. Resolve email collisions and inactive/suspended users explicitly. Do not import a password hash, reuse a Supabase token, mark addresses verified without independent proof, or elevate platform admin flags as part of the import. Test re-invites and account recovery with representative test accounts before any cutover.

## Storage: no binary copy adapter is included

The CLI validates and maps document metadata only. It makes **no Storage API calls** and does not claim that a mapped `storage_path` points to an object in Firebase Storage. Before any separately reviewed copy, create an offline manifest that records source bucket/path, destination project/document-scoped path, byte size, MIME type and SHA-256. Download to a restricted staging directory, verify checksums, reject path traversal/symlinks and duplicate destinations, and copy into a private Firebase Storage **emulator** first. Reconcile object counts, sizes, checksums and document metadata, and test access rules. Production object transfer needs a separately implemented, credential-scoped adapter and reviewed rollback; it is not an option supported by this CLI.

## Resume/checkpoint and reconciliation design

1. Keep the source export immutable and record its SHA-256 from the report.
2. Fix validation errors and repeat dry runs until `valid: true`. Reconcile source table counts against mapped collection counts (catalog/template tables intentionally fold into members rather than standalone documents).
3. For a local-only rehearsal, start Firestore Emulator Suite and use an explicit `demo-*` project ID. Apply requires an explicit checkpoint path; no Firebase apply is invoked by tests or CI.

```bash
firebase emulators:start --project demo-research-migration --only firestore
# In another terminal; use the host/port actually printed by the emulator.
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  node scripts/migration/cli.mjs \
  --input /secure/offline/source-export.json \
  --apply \
  --target-project demo-research-migration \
  --checkpoint /secure/offline/migration-checkpoint.json \
  --report /secure/offline/migration-apply-report.json
```

The adapter writes deterministic collection/ID order in batches below Firestore's batch limit, uses create semantics, and refuses a target document whose data conflicts with the source. A checkpoint binds completed collection/document IDs to the input SHA-256 and demo project; each completed batch is atomically checkpointed. Rerunning with the same export/checkpoint is idempotent: it skips checkpointed rows, accepts matching pre-existing documents, and refuses conflicting ones. If a commit/checkpoint is interrupted, rerun only after verifying the emulator and checkpoint; identical committed-but-uncheckpointed rows are safely recognized. Never reuse a checkpoint for a different input digest or project.

The reconciliation report distinguishes expected, planned, completed and remaining Firestore documents. Before accepting a rehearsal, require zero validation issues, expected equals planned, completed equals expected, and independently compare source/target counts and representative values/relationships. The report does not prove Auth or Storage completion.

## Rollback, data protection and production gate

- Take a verified, separately stored source backup and preserve its checksum. Keep the old Supabase service available until a signed-off rollback window ends.
- Rehearse with synthetic data and an isolated emulator. Do not use production exports in tests/fixtures or commit them.
- This CLI has no production adapter, delete mode, production credentials, or dual-write/cutover procedure. Do not change project/host guards to bypass that boundary.
- Before a future production migration, require independent mapping/security review, explicit maintenance window, Auth lifecycle plan, private Storage transfer plan, Firebase rules validation, permission review, count/checksum reconciliation, monitoring and a rollback runbook approved by the data owner. No production migration has been run by this change.
