# Research Team Platform

A multi-project research management platform built with Next.js, Firebase, and TypeScript. It provides first-class project teams and milestones, team-scoped task assignment, versioned immutable submissions, historical review records, private deliverables, a research calendar, authorized reporting, and Arabic/English interfaces. Production data has **not** been migrated or deployed as part of this code change.

## Technology

- Next.js App Router, React, TypeScript, Tailwind CSS
- Firebase Authentication (Identity Toolkit REST API and Admin-managed HTTP-only session cookies)
- Cloud Firestore (Firebase Admin SDK for server reads/writes, with client Security Rules)
- Firebase Cloud Storage (private bucket, signed upload/download URLs)
- Firebase Cloud Functions (Node.js 22) and Cloud Scheduler for daily in-app deadline reminders

The former `supabase/` SQL migrations are retained as historical source material; the running application uses Firebase. See [Migration notes](#existing-supabase-data).

## Implemented platform features

- Email/password signup, email verification, sign-in, password reset, and sign-out using Firebase Authentication with server-verified session cookies.
- Multiple projects with per-project memberships, role/permission templates, platform-admin bootstrap, and server-written activity history.
- First-class `teams` and `team_members` entities; team assignments and membership are distinct from project membership.
- First-class project/team milestones with dates, status and explicit researcher/team scope.
- Assignment- and team-scoped researcher access, manager-controlled task definitions, and a canonical task lifecycle (`assigned`, `accepted`, `in_progress`, `submitted`, `under_review`, `approved`, `revision_required`, `completed`, `cancelled`). Legacy task labels are normalized at data boundaries.
- Task-specific deliverable requirements, immutable versioned submission records, and separate immutable review decisions and feedback.
- Private Storage uploads with allow-listed formats, server-selected object paths, uploader-bound expiring reservations, a signed POST policy capped at 50 MB, and short-lived authorized downloads.
- Project-scoped day/week/month calendar, dashboard metrics, report views and authorized CSV export.
- User-scoped in-app assignment/review notifications and a source-controlled scheduled Function for deadline reminders.
- Arabic RTL and English LTR UI, responsive layouts, comments, export and activity views.

## Local setup

Requirements: Node.js 22 recommended, npm, and Java 21+ for Firebase Emulator Suite.

```bash
npm ci
npm ci --prefix functions
cp .env.example .env.local
# Add Firebase Admin credentials to .env.local (see below)
npm run dev
```

Open <http://localhost:3000>.

### Firebase project setup

The Firebase web-app configuration in `.env.example` is the public config supplied for project `research-team-platform`. The Firebase API key is a public project identifier, not an Admin credential. Keep Admin credentials private.

In Firebase Console:

1. Enable **Authentication → Email/Password**. Set authorized domains and configure verification/reset e-mail templates.
2. Create or verify the Cloud Firestore database.
3. Create the private default Cloud Storage bucket matching `FIREBASE_STORAGE_BUCKET`.
4. Provision a server service account with the minimum required Auth, Firestore and Storage permissions. Set either `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_CLIENT_EMAIL` plus `FIREBASE_PRIVATE_KEY` in the server environment; on Google Cloud, Application Default Credentials may be used.
5. Restrict the public Firebase API key to the required Identity Toolkit API where supported. Never expose a service-account JSON/private key to the browser or commit it.

The repository's `.firebaserc` points the Firebase CLI at `research-team-platform`; inspect the selected target before any deployment.

## Environment variables

| Variable                                        | Purpose                                                       | Exposure                   |
| ----------------------------------------------- | ------------------------------------------------------------- | -------------------------- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`                  | Firebase Auth REST API key                                    | Public Firebase web config |
| `FIREBASE_PROJECT_ID`                           | Firebase project ID                                           | Server config              |
| `FIREBASE_STORAGE_BUCKET`                       | Default Cloud Storage bucket                                  | Server config              |
| `FIREBASE_SERVICE_ACCOUNT_JSON`                 | Service-account JSON, if not using ADC                        | Server secret only         |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Alternative Admin SDK credentials                             | Server secrets only        |
| `NEXT_PUBLIC_SITE_URL`                          | Canonical origin for verification/reset links                 | Public URL                 |
| `PLATFORM_ADMIN_EMAILS`                         | Verified emails eligible for platform-admin bootstrap         | Server config              |
| `APP_TIMEZONE`                                  | Application date calculations and scheduled reminder timezone | Server/function config     |
| `NEXT_PUBLIC_DEFAULT_LOCALE`                    | Default `ar` or `en`                                          | Public config              |
| `FIREBASE_AUTH_EMULATOR_HOST`                   | Optional Auth emulator, e.g. `127.0.0.1:9099`                 | Local only                 |

The scheduled Function uses `APP_TIMEZONE` from its Functions environment and defaults to UTC; configure a `functions/.env.<project-id>` file only for the intended Firebase target, and do not commit secrets or environment files.

## Security Rules and tests

Security Rules are in `firestore.rules` and `storage.rules`; indexes are in `firestore.indexes.json`. Direct client writes to tasks (including create and delete), teams, memberships, milestones, submissions, reviews, deliverables, documents, comments and activity records are denied. Those mutations use validated server actions. The Admin SDK **bypasses Firebase Security Rules**, so every server query/action must enforce explicit authorization through `src/lib/firebase/compat.ts` and the shared policy layer. Do not add an Admin SDK route without these checks.

```bash
npm test
npm run test:migration
npm run typecheck
npm run test:firebase
npm run lint
npm run format:check
npm --prefix functions run lint
npm run build
```

The rules tests use the Firestore and Storage emulators. The signed upload flow also requires bucket CORS to allow `POST` and `Content-Type` from the deployed app origin; do not enable public bucket access.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for staged deployment steps and [docs/SECURITY.md](docs/SECURITY.md) for authorization boundaries. Rules/indexes and the scheduled Function have not been deployed by this implementation. Deploy to a staging project first and validate account roles, team isolation, submissions, reviews, uploads, downloads, calendar, reports and reminder delivery.

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
# Optional, after staging validation and Functions prerequisites:
firebase deploy --only functions:scheduledDeadlineNotifications
```

## Existing Supabase data

This repository previously used Supabase. The runtime migration does **not** copy existing PostgreSQL rows, Supabase Auth password hashes or Storage objects. A local JSON/JSONL importer validates and maps exports by default without network or Firebase writes; its explicit apply path is restricted to a loopback Firestore Emulator and `demo-*` project IDs. No production migration has run. Keep the old Supabase project and a verified backup until a separately approved migration is rehearsed. Password hashes are not imported; use reset/re-invite. Read [docs/MIGRATION_RUNBOOK.md](docs/MIGRATION_RUNBOOK.md) before preparing an export or rehearsal. Do not point production traffic at Firebase until data, rules, Storage, email delivery and rollback have been validated.

The legacy Supabase schema does not contain first-class teams, milestones, deliverables, submissions or reviews, nor team/version fields on tasks. The importer rejects unknown source tables rather than dropping them or fabricating history. Legacy task records therefore enter without a team or submission history; create the new research structures through the platform after the separately rehearsed data import.

## Key documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Permissions](docs/PERMISSIONS.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Supabase-to-Firebase Migration Runbook](docs/MIGRATION_RUNBOOK.md)
