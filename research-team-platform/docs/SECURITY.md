# Security model

## Trust boundaries

1. Firebase Authentication verifies the identity. The app exchanges a valid ID token for a `Secure` (in production), `HttpOnly`, `SameSite=Lax` session cookie and verifies the cookie server-side.
2. The Firebase Admin SDK is server-only and **bypasses Firestore/Storage Security Rules**. Server queries/actions must therefore enforce membership, resource visibility, field-level permissions, and input validation in application code.
3. Firestore Security Rules provide a second boundary for direct client SDK requests. They deny access by default and permit only explicitly authorized resources and own notification read acknowledgements.
4. Storage is private. The upload action checks membership/permission, chooses the path, allow-lists MIME type and size, then issues a short-lived signed POST policy. Signed URLs bypass Firebase Rules until expiry; issuance and expiry are security-critical.
5. The UI hides unavailable actions for usability only; it is not an authorization boundary.

## Authentication

- Firebase Auth email/password endpoints are called server-side through Identity Toolkit REST.
- Session cookies are HTTP-only, `SameSite=Lax`, and `Secure` in production. Logout clears the cookie.
- Verification and password-reset action codes are handled by `/auth/confirm`; reset codes are validated again server-side.
- Redirects after login use `safeRedirectPath` to reject absolute/open redirects.
- Password reset returns a generic success response to avoid disclosing account existence.
- Restrict Auth authorized domains and configure rate limits, SMTP/templates, and API key restrictions in Firebase Console.

## Firestore and application authorization

- `firestore.rules` denies unknown collections and protects profile flags, project memberships, permission catalogs, and activity records from direct writes.
- Task reads are assignment-limited for researchers. Reviewers see only the review queue; project managers with `tasks.view` may see all project tasks.
- Researchers assigned to a task can change only allowed progress, work-note, and status fields. Task definition, due date, priority, assignment, project ownership, and membership/permission records are manager-controlled.
- The server adapter repeats these checks because Admin access bypasses the Rules. It also filters documents by explicit `authorized_users`, and comments by project/task visibility.
- Activity entries are written server-side and are not mutable through the app adapter. They include actor, event, entity, old/new values, and request metadata where available.
- Notifications are readable only by their `user_id`; direct updates can only acknowledge `read_at`.

## Storage

- Keep the Firebase bucket private. Allowed research file types are validated by extension and MIME mapping; the signed POST policy binds the content type, object path and a maximum size of 50 MB.
- Upload URLs expire after five minutes. Download URLs are issued only after the document record and the user's explicit/role-based access are checked, and expire within five minutes.
- Do not reuse or publish signed URLs as permanent links. Set bucket CORS only for trusted application origins and the needed methods/headers.
- File deletion checks ownership/permission and removes the Firestore metadata and object through authorized server actions.

## Operational controls

- Store Firebase Admin service-account credentials only in server-side secret storage or use Application Default Credentials on Google Cloud. Never prefix Admin secrets with `NEXT_PUBLIC_` or commit them.
- The public Firebase web API key is not an Admin credential; still restrict it to the required APIs and monitor quotas.
- Before deploying Rules/indexes, back up and inspect the target project. A rule deployment can break existing clients if applied to the wrong Firebase project.
- Keep the old Supabase environment available until any independent data migration is validated. This branch does not migrate or delete the old data.
- Run `npm test`, `npm run typecheck`, `npm run test:firebase`, `npm run lint` and `npm run build` before production rollout.

## Known limitations

Admin SDK operations and activity logging are not all wrapped in one Firestore transaction; multi-write workflows can require reconciliation after a partial failure. The current code migration does not include an automated legacy data importer, push notifications, or a versioned task-submission entity. Do not market those as implemented until built and integration-tested.
