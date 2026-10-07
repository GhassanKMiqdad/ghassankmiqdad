# Supabase → Firebase Migration Runbook

**Status:** Operational procedure prepared; no production data, user accounts, or files have been migrated by this runbook authoring task. The code defaults to dry-run. Production cutover remains blocked until a staging run and verification are accepted.

## 1. What the tools do—and do not do

- `npm run migrate:firebase` is a **read-only dry-run by default**. It reads Supabase Auth, PostgREST tables, and the configured Storage bucket, then reports planned changes. It does not write either system in dry-run mode.
- An apply requires `--apply`, an exact `--confirm-apply=<target-id>` flag, and `MIGRATION_SOURCE_FROZEN=1`. Applying to the configured production project also requires `--confirm-production=<production-id>`.
- Firestore records are created only when absent. Equal existing records are skipped; different records are never overwritten. Cloud Storage uploads use a create-only generation precondition and are verified by size and MD5. Interrupted runs can be repeated; inspect the report and resolve conflicts before retrying.
- The apply is **not a cross-service transaction**. Auth, Firestore collections, and Storage can be partially populated if an operation fails. The reports and create-only behavior make that state resumable, not atomic. Use a fresh, isolated staging project first; in production, pause traffic and retain the source unchanged until verification and acceptance.
- `MIGRATION_SOURCE_FROZEN=1` is an operator assertion, not an automated proof that Supabase writes are disabled. Freeze the application/source before applying.
- The migration code contains no Supabase write or delete operations. The supplied Supabase service-role credential is nevertheless privileged; use it only in a restricted one-off runner/secret store and revoke or rotate it after the migration window according to the source-system owner’s change process. Never commit it or place it in reports.

## 2. Entity and identity mapping

| Supabase source                          | Firebase target                                   | Notes                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.users`                             | Firebase Authentication user                      | Preserve UID, e-mail, verification and disabled/banned state when available. No password hashes are copied; users must reset passwords. OAuth identities must be re-linked manually. Missing e-mail, duplicate e-mail, or UID conflicts block or require reconciliation. |
| `profiles`                               | `profiles/{uid}`                                  | Profile fields are projected from the source profile and Auth record.                                                                                                                                                                                                    |
| `projects`                               | `projects/{id}`                                   | Logical IDs are preserved.                                                                                                                                                                                                                                               |
| `project_members`                        | `project_members/{projectId}_{uid}`               | Logical project/user relationship is preserved. Permissions are reduced to the current role template and safe researcher progress/note/submit grants; every downgrade is reported for review.                                                                            |
| `user_permissions`                       | `user_permissions/{projectId}_{uid}_{permission}` | Only grants permitted by the current role template are retained.                                                                                                                                                                                                         |
| `tasks`                                  | `tasks/{id}`                                      | IDs are preserved; legacy statuses/fields are validated and mapped.                                                                                                                                                                                                      |
| `documents`                              | `documents/{id}`                                  | Document metadata is preserved; migrated source documents are restricted to the uploader unless target policy grants an authorized manager access.                                                                                                                       |
| Supabase Storage object                  | Firebase Storage object at the same path          | The configured source bucket is copied to the target default bucket without deleting the source. Metadata is preserved where available; size and MD5 are checked on upload.                                                                                              |
| `comments`                               | `comments/{id}`                                   | IDs and supported fields are preserved.                                                                                                                                                                                                                                  |
| `activity_logs`                          | `activity_logs/{id}`                              | IDs and source fields are projected; retain migration reports and source audit history.                                                                                                                                                                                  |
| Legacy `permissions`, `role_permissions` | Current code-controlled catalog collections       | The target catalog is seeded from current Firebase code definitions, not copied blindly. Catalog/template differences must be reviewed.                                                                                                                                  |

The retained Supabase schema has no versioned submission/review tables or notification history to transfer. Current task state is copied, but historical submission/review versions cannot be reconstructed. New Firebase notifications are created by the application workflow after cutover; they are not synthesized from the old schema.

The `platform_admin` Firebase Auth custom claim is synchronized from the source profile flag as a separate, reported migration step. Direct Firestore/Storage rules rely on this Admin-SDK-managed claim; do not grant it from client code. Any affected existing target account must sign in again after claim synchronization to receive the updated claim in its ID token.

## 3. Required access and separation

Obtain these through the organization’s approved secret manager and Firebase/Supabase administrators; do not send them in chat or commit them:

- Supabase project URL, the exact source bucket name, and a short-lived server-side Supabase service-role secret for Auth user listing and private Storage reads.
- A verified Supabase database backup/export and a Storage inventory/backup, with a recovery owner and retention window.
- A **separate, disposable Firebase staging project** and Admin credentials authorized for Auth import/list, Firestore read/write, and Cloud Storage read/write. Do not use the production Firebase project as staging.
- Production Firebase Admin credentials only for the later production window; verify project ID and bucket in the Firebase Console before use.
- Access to hosting environment settings and the previously deployed Supabase application release for rollback.

Do not configure `FIREBASE_PROJECT_ID` to production during staging. The source and target should be frozen to the same reviewed snapshot during apply and verification.

## 4. Staging migration procedure

### 4.1 Prepare a staging target

1. Create a separate Firebase staging project. Enable Email/Password Auth, create Firestore and a private Storage bucket, and add only the staging app URL to Auth authorized domains.
2. Configure staging CORS for the app’s actual upload origin and required `POST`/`Content-Type` behavior. Confirm bucket rules remain private.
3. From the repository root, install the lockfile and run local gates:

   ```bash
   cd research-team-platform
   npm ci
   npm run lint
   npm run format:check
   npm run typecheck
   npm test
   npm run test:firebase
   npm run build
   ```

4. Supply secrets through an ephemeral shell/secret manager. Use the **actual** staging project and bucket identifiers; do not infer them solely from a project name:

   ```bash
   export SUPABASE_URL='https://<source-project>.supabase.co'
   export SUPABASE_SERVICE_ROLE_KEY='<from-secret-manager>'
   export SUPABASE_STORAGE_BUCKET='<source-private-bucket>'
   export FIREBASE_PRODUCTION_PROJECT_ID='research-team-platform'
   export FIREBASE_MIGRATION_PROJECT_ID='<separate-staging-project-id>'
   export FIREBASE_PROJECT_ID="$FIREBASE_MIGRATION_PROJECT_ID"
   export FIREBASE_STORAGE_BUCKET='<verified-staging-bucket>'
   export FIREBASE_SERVICE_ACCOUNT_JSON='<staging-service-account-json-from-secret-manager>'
   ```

   If using `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` or Application Default Credentials instead of `FIREBASE_SERVICE_ACCOUNT_JSON`, configure only that supported alternative. Never set both forms inconsistently.

### 4.2 Back up, freeze, dry-run

1. Take a fresh Supabase database backup and Storage backup/inventory. Record the backup identifiers and source bucket. Test that the backup is readable in the approved recovery environment.
2. Put the currently deployed Supabase application into maintenance/read-only mode using the hosting/provider procedure; pause background writers and any external integrations. Verify a normal application write is rejected. Do not delete, rename, or revoke the source project.
3. Set `MIGRATION_SOURCE_FROZEN=1` **only after** the freeze check. First run the read-only dry-run against the snapshot:

   ```bash
   export MIGRATION_SOURCE_FROZEN=1
   npm run migrate:firebase -- --dry-run
   ```

4. Review `migration-reports/<run-id>.json` (or the path selected by `MIGRATION_REPORT_PATH`) privately. It can contain internal record identifiers and storage paths. It is git-ignored; keep the report access-controlled and attach it only to the organization’s approved restricted incident/change record.
5. Resolve every `blocking` issue before apply. Investigate/reconcile duplicate e-mails, missing relationships/objects, unsupported roles/statuses, permission downgrades and target conflicts. Review permission/catalog differences, OAuth accounts, oversized files, and any unexpected pre-existing target data. Do not proceed if the snapshot changed after dry-run.

### 4.3 Apply to staging and verify

After a reviewer approves the dry-run report, apply to the staging project only:

```bash
npm run migrate:firebase -- --apply \
  --confirm-apply="$FIREBASE_MIGRATION_PROJECT_ID"
```

The command refuses to run if the source-freeze marker, production-project ID, or exact target confirmation is missing. On any failed Auth import or blocking source relationship, it stops before downstream data writes. Later per-collection or Storage failures may leave safe create-only partial data; resolve the reported errors and rerun against the same frozen snapshot.

Run read-only reconciliation with full object checksums:

```bash
npm run verify:migration
```

The verifier creates a machine-readable JSON report and a human-readable Markdown companion side by side under `migration-reports/` by default. `MIGRATION_VERIFY_REPORT_PATH` overrides the JSON path; the corresponding Markdown file is written alongside it. Keep both reports private.

Accept staging only when there are **zero blocking findings**, zero missing or mismatched records/files, zero broken references, no unresolved Auth UID/e-mail conflicts, and all review findings are explicitly dispositioned. Catalog differences and unexpected target users/objects require review. Do not use `--skip-checksums` for acceptance; it checks path/size but not file bytes.

### 4.4 Staging application/security test plan

Deploy the candidate app and rules to staging. Test using separate accounts and real direct client requests, not only hidden UI:

- Director/owner can create projects/tasks, assign a member, review submissions, request a revision, and approve a resubmission.
- Researcher A sees only assigned work and explicitly shared documents; changing project/task/document IDs or calling Firestore/Storage directly cannot expose Researcher B, an unassigned project, or another user’s private files.
- Researcher cannot change task owner, instructions, due date, priority, project, role, or permissions; Admin SDK Server Actions reject forged IDs and unauthorized status transitions.
- Submit → review → revision-required → researcher update/resubmit → approval is auditable and emits notifications only to the intended recipient. A non-recipient cannot read the notification.
- Upload/download allowed files within size/type limits; direct unauthorized reads, upload, and delete are denied. Confirm signed upload URLs are bounded and short-lived.
- Test Auth sign-up, e-mail verification, sign-in, password reset, sign-out, disabled/banned user handling, and forced password reset after imported accounts. An OAuth account must be explicitly re-linked before relying on it.
- Test password change with correct and incorrect current password; successful change invalidates all sessions and returns the user to sign-in.
- Check Arabic RTL and English LTR on desktop and phone; verify no unintended horizontal overflow.
- Execute the staging rollback rehearsal in §6 before production cutover.

## 5. Production cutover sequence

Production remains **not authorized by this runbook alone**. Start only after staging acceptance, explicit change-window approval by the system owner, a verified restore point, and access to production secrets.

1. Confirm the production project ID is `research-team-platform`; verify the app, Auth provider, Firestore database, Storage bucket, quotas/billing, authorized domains, CORS and hosting variables in the Firebase Console. Check for existing production Auth users/documents/objects. The migration tool never overwrites different data, but pre-existing conflicts can create a partial additive migration; reconcile them before cutover.
2. Take and validate fresh Supabase DB/Storage backups. Record the exact source snapshot time and known counts. Schedule an outage/maintenance window and identify the operator who can restore the prior Supabase release.
3. Freeze every source writer and verify the freeze. Deploy/review Firestore rules, indexes and Storage rules with an explicit production target only after the change owner approves:

   ```bash
   firebase deploy --project research-team-platform \
     --only firestore:rules,firestore:indexes,storage
   ```

4. Set `FIREBASE_PRODUCTION_PROJECT_ID=research-team-platform`, `FIREBASE_MIGRATION_PROJECT_ID=research-team-platform`, and `FIREBASE_PROJECT_ID=research-team-platform`; load the matching production Admin credential and actual bucket from the approved secret manager. Set `MIGRATION_SOURCE_FROZEN=1` only while the source remains frozen.
5. Run and review one final dry-run on the frozen production source. Apply only after the report is accepted:

   ```bash
   npm run migrate:firebase -- --dry-run
   npm run migrate:firebase -- --apply \
     --confirm-apply="$FIREBASE_MIGRATION_PROJECT_ID" \
     --confirm-production="$FIREBASE_PRODUCTION_PROJECT_ID"
   npm run verify:migration
   ```

6. Do not open production traffic unless verification has zero blocking findings, zero missing/mismatched records, zero missing or checksum-mismatched files, zero broken references, and the organization has accepted every review finding, password-reset requirement, OAuth re-link requirement, and permission downgrade. Store JSON/Markdown reports only in the restricted change record.
7. Deploy the Firebase application with server-only Admin credentials and the public Firebase web configuration. Complete the production smoke/security checklist in §4.4, including negative direct-access tests. Monitor closely before ending the maintenance window.
8. Keep Supabase, backups, and logs intact and available for rollback for the agreed retention period. Do not delete the source or claim the migration is production-verified until the operational owner signs off.

The exact target confirmation flags are safeguards, not authorization. Running an apply or production deploy is an operator-controlled change with the user’s normal production approval process.

## 6. Rollback and rehearsal

There is no automatic Firebase → Supabase reverse migration. Firebase writes made after cutover may use different schema, new workflow states, or entities that do not exist in the Supabase model. A traffic rollback can therefore require manual reconciliation and cannot promise lossless reverse sync.

### Staging rehearsal (required)

1. Record the staging cutover timestamp and a before-state backup/export of Supabase and Firebase Auth/Firestore/Storage.
2. Create representative post-cutover changes in Firebase: a task update, a review/revision transition, a notification and an uploaded deliverable.
3. Enable maintenance mode. Export the changed Firebase records, activity logs, Auth user IDs and Storage object names/metadata since the timestamp. Keep these exports access-controlled.
4. Redeploy the exact last-known-good Supabase app release and restore its server/browser variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, and applicable platform/timezone/locale settings) from the secret manager. Do not use values from this guide as credentials.
5. Reconcile each Firebase-only change into Supabase manually using a reviewed field-by-field mapping. Reconcile files and accounts separately; flag Firebase-only workflow states, notifications, or users that Supabase cannot represent. Do not discard or silently overwrite those changes.
6. Smoke-test login, assigned-task visibility, uploads/downloads and authorization against Supabase. Keep the Firebase exports and both systems intact. The rehearsal is successful only when every test change is accounted for, not merely when the old release starts.

### Production rollback sequence

1. Put the Firebase app in maintenance/read-only mode; stop background writers and preserve the cutover time, migration report IDs, Firebase logs and current state. Do **not** delete Firebase data or source backups.
2. Export Firebase Auth users/UIDs, Firestore records/activity logs and Storage object inventory; identify all writes since cutover. Store checksummed exports in the approved restricted backup location.
3. Redeploy the last-known-good Supabase application artifact and restore its Supabase environment variables from the secret manager. Keep Firebase credentials out of the prior build and keep the Firebase project intact.
4. Before reopening writes on Supabase, reconcile all Firebase-only user/task/status/file changes that Supabase can represent. Produce an exception list for unsupported review history, notifications, data, files or accounts. If any user changes would be lost, remain in maintenance until the system owner accepts a manual recovery decision.
5. Smoke-test Supabase login/logout, project/task assignment privacy, Storage access and audit logging; then reopen traffic and monitor. Retain both systems, backups and exports for the agreed retention period. Do not attempt to run the one-way Supabase → Firebase script as a reverse migration.

## 7. Monitoring, incident response and cost

During staging and production, monitor Firebase Console/Cloud Monitoring and Cloud Logging for:

- Firestore read/write/delete operations, permission denials, latency, quota and error rate.
- Cloud Storage bytes/operations, upload/download failures, denied requests and unexpected egress.
- Firebase Auth sign-in/reset failures, disabled-user attempts and unusual volume.
- Next.js server errors, Server Action failures, signed upload/download errors and response latency.
- Migration reports: planned/created/skipped/conflict/failed counts, blocking/review issues, verification mismatches and checksum failures.
- Billing budgets and alerts for Firestore, Storage, network egress and hosting. Budgets alert; they do not necessarily cap usage. Review expected free-tier quotas and payment settings directly in the target provider before launch.

Keep dashboards/log access role-restricted. Do not log passwords, service-account JSON, bearer/session cookies, signed URLs, or full document contents. Define an on-call owner, alert recipients, incident severity thresholds and a retention policy before production launch.

## 8. Known scope and acceptance limits

The runtime/backend migration and current task workflow are implemented in the codebase, but the following remain outside this cutover implementation: a nested team hierarchy, calendar, formal report builder, versioned submission records, and versioned review records. Historical versions are not available from the retained source schema. Do not represent these as delivered capabilities.

No production migration, Firebase rules deployment, production smoke test, or production rollback rehearsal is evidenced by this repository work alone. Production readiness must be re-evaluated from real staging/production reports and owner acceptance.
