# E. Security model

## Principles

1. **The database decides.** Every read and write reaches PostgreSQL with the
   signed-in user's JWT. Row Level Security, column privileges, triggers and
   RPC checks enforce every rule, so a request that bypasses the UI — a
   crafted `fetch`, a modified Server Action call, the Supabase API used
   directly with a stolen _anon_ key — is rejected exactly like a click on a
   hidden button would be.
2. **Never trust the client.** Permissions, roles, creators, uploaders, file
   sizes and MIME types are never taken from the request. Identity comes from
   the verified JWT (`auth.uid()`); effective permissions are computed by the
   database; file facts come from Storage.
3. **Defence in depth.** The server layer re-validates every input (Zod) and
   re-checks permissions to return precise messages; the UI hides what a user
   cannot do. Both are conveniences on top of rule 1, never a replacement.
4. **Least privilege.** The service-role key is used in three narrow,
   server-only places; everything else runs as the user.
5. **Everything sensitive is audited** by the database itself, in an
   append-only log.

## Layers

### 1. Authentication (Supabase Auth)

- E-mail + password with mandatory e-mail confirmation, password recovery and
  invitations. E-mail links use `token_hash` (`/auth/confirm`), so they work
  across devices; the PKCE callback (`/auth/callback`) covers OAuth-style
  redirects.
- Sessions are kept in HTTP-only cookies by `@supabase/ssr`. `proxy.ts`
  refreshes them on navigation and verifies the JWT (`getClaims()`); server
  code never relies on an unverified session object.
- Redirect targets (`?next=`) are restricted to same-site paths
  (`safeRedirectPath`), preventing open redirects.
- Sign-in, sign-up and reset requests return messages that do not reveal
  whether an e-mail is registered. Supabase Auth rate limits apply
  (configured in `supabase/config.toml` for local development and in the
  dashboard for hosted projects).
- Platform-admin bootstrap (`PLATFORM_ADMIN_EMAILS`) only applies to accounts
  whose e-mail is **confirmed**.

### 2. Application server (Next.js)

- Mutations are Server Actions (POST only, Next.js origin check = CSRF
  protection). Each one runs through `runAction`: session check → Zod parsing
  of untrusted input → permission check against database-computed access →
  user-scoped query.
- Expected failures become fixed, localized messages (for example
  «ليس لديك صلاحية لتنفيذ هذه العملية.», «لا يمكنك تعديل هذه المهمة.»,
  «لا يمكنك الوصول إلى هذا المشروع.»). Unexpected errors are logged on the
  server and reported generically — no stack traces, SQL or internal codes
  reach the browser.
- Resources that the user may not see answer exactly like missing ones
  (no existence oracle for IDs).
- The export endpoint (`/api/projects/:id/export`) requires `data.export`,
  writes the audit entry **before** streaming data, and neutralizes
  spreadsheet formula injection in CSV cells. Before the audit entry, it calls
  the PostgreSQL-backed `check_project_export_rate_limit` RPC. The default is
  five exports per user/project per 60 seconds (`EXPORT_RATE_LIMIT` and
  `EXPORT_RATE_WINDOW_SECONDS`); rejected requests return HTTP 429 with
  `Retry-After`. The counter is atomic and shared across application instances.
- The service-role client (`src/lib/supabase/admin.ts`) is guarded by
  `server-only` and used only to: send invitations (Auth admin API), remove a
  deleted project's files after the user's own RLS-checked deletion
  succeeded, and bootstrap platform admins from configuration.

### 3. Database (PostgreSQL)

| Mechanism               | What it guarantees                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS on every table      | Users only see and touch rows of projects where they hold the needed permission; everything is scoped by `project_id`.                                                                                                                         |
| Column-level `GRANT`s   | Only editable columns can be written (e.g. `tasks.project_id`, `created_by`, `profiles.is_platform_admin`, `documents.size_bytes` cannot be changed by users). Membership, permission and audit tables have **no** client write grants at all. |
| `BEFORE` triggers       | Field-level rules inside an allowed row: assignment, review workflow, content edits, immutable fields, server-assigned creator/uploader, file existence/size/MIME from Storage.                                                                |
| `SECURITY DEFINER` RPCs | The only way to create projects and change memberships/permissions. Each one re-checks the caller explicitly (rank, self-modification, escalation). All pin `search_path = ''` and fully qualify names.                                        |
| `private` schema        | Helper functions are not exposed through the Data API; `EXECUTE` is revoked from `anon`.                                                                                                                                                       |
| Constraints             | Composite foreign keys keep assignees, comments and grants inside the same project; CHECK constraints bound text sizes and file paths.                                                                                                         |

### 4. Storage

- Private bucket `project-documents` (no public URLs), 50 MB limit and a
  MIME allow-list (no HTML, SVG or executables).
- Policies use the first folder of the object name as the project id, so
  upload/download/delete reuse the same permission helper as the tables.
- Paths are chosen by the server (`<project>/<uuid>/<sanitized-name>`), files
  are never overwritten (no `UPDATE` policy, no upsert), downloads use
  short-lived signed URLs, and `Content-Disposition` forces downloads when
  requested.

Private task files (NestHire Workspace) live in the same bucket but carry a
`task_id`: the object SELECT policy defers to the `documents` RLS, so a task
file is readable only by the task's supervisors and responsible member, and by
the team only once it is part of a publication. Files handed in with a version
are locked. A new assignee does not inherit a previous assignee's files,
versions, reviews or conversation. Nobody — Directors included — reviews,
approves or publishes work they submitted. See
[NESTHIRE.md §9](NESTHIRE.md#9-security-hardening-nesthire-workspace).

### 5. Audit log

- Written by triggers and RPCs inside the same transaction as the change,
  with actor (from the JWT), action, entity, old and new values, IP address
  and user agent.
- Immutable: no client grants, and a trigger rejects `UPDATE`, `DELETE` and
  `TRUNCATE` for every role.
- IP address and user agent are **informational**: the application forwards
  the values it receives from the hosting platform (on Vercel,
  `x-forwarded-for` is set by the edge and cannot be spoofed by the browser);
  callers that talk to the Supabase API directly can send arbitrary headers.
  The actor identity, in contrast, always comes from the verified JWT.

### 6. HTTP hardening

`next.config.ts` sends a Content-Security-Policy (no third-party origins,
`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`),
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict
`Referrer-Policy`, a restrictive `Permissions-Policy` and, when the backend is
served over HTTPS, HSTS and `upgrade-insecure-requests`. The `X-Powered-By`
header is disabled.

## Threat model

| Threat                                                                                                  | Mitigation                                                                                                                                                                | Verified by                                               |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Calling the API directly to perform a hidden action                                                     | RLS + grants + triggers + RPC checks on every request                                                                                                                     | `tests/integration/api-security.test.ts`, pgTAP 02–05, 07 |
| IDOR (guessing another project's IDs)                                                                   | RLS returns nothing; server answers "not found / no access"; composite FKs                                                                                                | integration "project isolation", pgTAP 02                 |
| Cross-project access / moving data between projects                                                     | Every row scoped by `project_id`; `project_id` not updatable; path CHECK for files                                                                                        | integration, pgTAP 02, 03, 05                             |
| Privilege escalation (self-grant, granting unheld permissions, promoting oneself, becoming owner/admin) | `set_member_permissions` (no self-edit, rank, escalation check), no write grants on `project_members` / `user_permissions` / platform flags, owner role only via transfer | integration "member" & "manager", pgTAP 04                |
| Editing tasks without the right relation                                                                | `tasks_update` RLS gate + `tasks_before_update` field rules                                                                                                               | integration "research member", "reviewer", pgTAP 03       |
| Unauthorized deletion (tasks, documents, comments, projects, files)                                     | Dedicated `*.delete` permissions in RLS and storage policies                                                                                                              | integration, pgTAP 03, 05                                 |
| Unauthorized permission changes                                                                         | Only `permissions.manage` through the RPC; audited with old/new values                                                                                                    | integration, pgTAP 04, 06                                 |
| Tampering with the audit trail                                                                          | No grants + immutability trigger                                                                                                                                          | integration "activity log", pgTAP 06                      |
| Forged or tampered JWTs                                                                                 | Signature verification by the Supabase API gateway / PostgREST                                                                                                            | integration "forged tokens"                               |
| Uploading malicious content                                                                             | MIME allow-list (bucket + server), sanitized names, private bucket, downloads as attachments                                                                              | unit `files.test.ts`, pgTAP 05                            |
| Spoofed creator / uploader / file size                                                                  | Set by triggers from `auth.uid()` and Storage metadata                                                                                                                    | pgTAP 03, 05                                              |
| CSRF on mutations                                                                                       | Server Actions: POST + Next.js origin check; auth cookies `SameSite=Lax`                                                                                                  | —                                                         |
| XSS                                                                                                     | React escaping, no `dangerouslySetInnerHTML` for user content, CSP                                                                                                        | —                                                         |
| Open redirect after login                                                                               | `safeRedirectPath`                                                                                                                                                        | browser walkthrough                                       |
| Secret leakage                                                                                          | Only `NEXT_PUBLIC_*` values reach the browser; the service-role key is server-only (`server-only` guard) and never committed (`.env*.local` ignored)                      | —                                                         |
| A member reads another member's private work or drafts                                                  | Task rows, submissions and reviews readable only by supervisors and the responsible member; the team reads only the sanitized `task_publications`                         | pgTAP 08, integration "NestHire (A / B / C)"              |
| A member publishes, approves or completes their own work, or edits the schedule                         | No column privilege on `visibility` / workflow dates; transitions only through workflow functions with reviewer + self-review checks; schedule fields need `tasks.edit`   | pgTAP 03, 08, integration                                 |
| Self-promotion to Team Lead / Director                                                                  | Roles only through Director functions; no client write on `is_director`, `teams`, `team_members`; last Director protected                                                 | pgTAP 08, integration                                     |
| Removed / suspended member keeps access                                                                 | Every check reads membership status at request time                                                                                                                       | pgTAP 02, 04; browser walkthrough                         |

## Operating the system securely

- Keep `SUPABASE_SERVICE_ROLE_KEY` only in server-side environment variables
  (Vercel → _Environment Variables_, never with a `NEXT_PUBLIC_` prefix) and
  rotate it if it is ever exposed.
- In the Supabase dashboard: keep _Confirm email_ enabled, configure a custom
  SMTP server for production e-mail, set _Site URL_ and _Redirect URLs_ to the
  production domain, enable leaked-password protection and review the Auth
  rate limits.
- Enable Point-in-Time Recovery / backups for the database.
- Apply schema changes only through migrations, and run `npm run test:db`
  and `npm run test:integration` against a disposable environment before
  deploying them.
- Service-role scripts and the SQL editor bypass RLS and business-rule
  triggers by design (`private.is_system_context()`); restrict who can use
  them.

## Dependency audit note

`npm audit --omit=dev` is clean. The full audit currently reports five high
severity development-only advisories through the ESLint chain (`braces` →
`micromatch` → `fast-glob` → `@next/eslint-plugin-next`). The available fix is
an incompatible downgrade to `eslint-config-next@14.2.35`; `braces` currently
has no newer npm release. The project therefore does not apply
`npm audit fix --force`; this remains a development-tooling blocker to a clean
full audit and should be revisited when the upstream dependency publishes a
compatible fix.
