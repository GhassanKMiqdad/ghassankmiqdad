# Research Team Platform

Research team management platform built on the existing Next.js application. It includes project and member management, project-scoped permissions, private documents, assigned tasks, researcher progress/work notes, a review/revision status flow, bilingual Arabic/English UI, and in-app task notifications.

## Technology

- Next.js App Router, React, TypeScript, Tailwind CSS
- Firebase Authentication (Identity Toolkit REST API and Admin-managed HTTP-only session cookies)
- Cloud Firestore (Firebase Admin SDK for server reads/writes, with client Security Rules)
- Firebase Cloud Storage (private bucket, signed upload/download URLs)

The former `supabase/` SQL migrations are retained as historical source material only; the running application uses Firebase. **No production data has been copied or deleted as part of this code migration.** See [Migration notes](#existing-supabase-data).

## Implemented foundations

- Email/password signup, email verification, sign-in, password reset, and sign-out using Firebase Authentication.
- Server-verified Firebase session cookies; server actions re-validate input and project permissions.
- Project memberships, roles, per-member permission templates, platform-admin bootstrap, and audit activity records in Firestore.
- Assignment-limited task visibility; researchers can update progress/work notes and move assigned tasks through allowed execution/review states, but cannot edit manager-controlled task definitions or assignments.
- Task instructions, expected output and required-deliverable fields; review, revision-required and completion transitions.
- Private document uploads with allow-listed formats, an exact server-selected object path, a signed POST policy that constrains MIME type and the 50 MB maximum, and short-lived signed downloads.
- User-scoped in-app notifications for task assignment, review, revision and approval.
- Arabic RTL and English LTR, existing responsive shell, comments, CSV/JSON export and activity history.

This branch completes the Firebase backend/security migration and these task-workflow foundations; it is not a claim that every item in the original master brief (for example a nested multi-team entity, calendar, report builder, and versioned deliverable-review records) is implemented.

## Local setup

Requirements: Node.js 22 recommended, npm, Java 21+ for Firebase Emulator Suite.

```bash
npm ci
cp .env.example .env.local
# Add Firebase Admin credentials to .env.local (see below)
npm run dev
```

Open <http://localhost:3000>.

### Firebase project setup

The Firebase web-app configuration in `.env.example` is the public config supplied for project `research-team-platform`. The Firebase API key is a public project identifier, not an Admin credential. Keep Admin credentials private.

In Firebase Console:

1. Enable **Authentication → Email/Password**. Set the production authorized domain and configure the verification/reset e-mail templates.
2. Create/verify the Cloud Firestore database in production mode.
3. Create the private default Cloud Storage bucket matching `FIREBASE_STORAGE_BUCKET`.
4. Provision a server service account with the minimum required Auth, Firestore and Storage permissions. Set either `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_CLIENT_EMAIL` plus `FIREBASE_PRIVATE_KEY` in the server environment; on Google Cloud, Application Default Credentials may be used.
5. Restrict the public Firebase API key to the required Identity Toolkit API where supported. Never expose a service-account JSON/private key to the browser or commit it.

The repository's `.firebaserc` points the Firebase CLI at `research-team-platform`. Review the target project before deployment.

## Environment variables

| Variable                                        | Purpose                                                               | Exposure                   |
| ----------------------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`                  | Firebase Auth REST API key                                            | Public Firebase web config |
| `FIREBASE_PROJECT_ID`                           | Firebase project ID                                                   | Server config              |
| `FIREBASE_STORAGE_BUCKET`                       | Default Cloud Storage bucket                                          | Server config              |
| `FIREBASE_SERVICE_ACCOUNT_JSON`                 | Service-account JSON, if not using ADC                                | Server secret only         |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Alternative Admin SDK credentials                                     | Server secrets only        |
| `NEXT_PUBLIC_SITE_URL`                          | Canonical origin for verification/reset links                         | Public URL                 |
| `PLATFORM_ADMIN_EMAILS`                         | Comma-separated verified emails eligible for platform-admin bootstrap | Server config              |
| `APP_TIMEZONE`                                  | Date/overdue calculations (IANA zone)                                 | Server config              |
| `NEXT_PUBLIC_DEFAULT_LOCALE`                    | Default `ar` or `en`                                                  | Public config              |
| `FIREBASE_AUTH_EMULATOR_HOST`                   | Optional Auth emulator, e.g. `127.0.0.1:9099`                         | Local only                 |

## Security Rules and tests

Security Rules are in `firestore.rules` and `storage.rules`; indexes are in `firestore.indexes.json`. Direct client access is restricted. The Admin SDK **bypasses Firebase Security Rules**, so every server query/action also applies explicit authorization in `src/lib/firebase/compat.ts` and the shared policy layer. Do not add a server route that uses Admin SDK without those checks.

```bash
npm test
npm run typecheck
npm run test:firebase
npm run lint
npm run build
```

The Firebase rules tests use the Firestore and Storage emulators. The signed POST upload flow also requires bucket CORS to allow `POST` and `Content-Type` from the deployed app origin; do not enable public bucket access.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for environment setup and deployment steps. Deploy rules and indexes only after reviewing the target Firebase project:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

## Existing Supabase data

This repository previously used Supabase. The migration in this branch replaces the application runtime; it does **not** migrate existing PostgreSQL rows, Supabase Auth password hashes, or Storage objects. Keep the old Supabase project and take a verified backup until a separately tested data migration has been run. Password hashes generally cannot be imported into Firebase Auth; plan an account verification/password-reset flow. Do not point production traffic at Firebase until data, rules, storage, email delivery, and rollback have been validated.

## Key documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Permissions](docs/PERMISSIONS.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
