# Security model

## Trust boundaries

1. Firebase Authentication verifies identity. The app exchanges a valid ID token for a `Secure` (in production), `HttpOnly`, `SameSite=Lax` session cookie and verifies the cookie server-side.
2. The Firebase Admin SDK is server-only and **bypasses Firestore/Storage Security Rules**. Server queries/actions must therefore enforce membership, resource visibility, field-level permissions and input validation in application code.
3. Firestore Rules provide a second boundary for direct client SDK requests. They deny writes to task, team, team-membership, milestone, submission, review, deliverable, document, comment and audit records; only explicitly authorized reads and own notification `read_at` acknowledgements are allowed.
4. Storage is private. The upload action validates the active project permission, chooses the path, allow-lists MIME type and size, and issues a short-lived signed POST policy tied to an expiring, user-bound reservation. Signed URLs bypass Firebase Rules while valid; issuance and expiry are security-critical.
5. The UI hides unavailable actions for usability only; it is not an authorization boundary.

## Authentication

- Firebase Auth email/password endpoints are called server-side through Identity Toolkit REST.
- Session cookies are HTTP-only, `SameSite=Lax`, and `Secure` in production. Logout clears the cookie.
- Verification and password-reset action codes are handled by `/auth/confirm`; reset codes are validated again server-side.
- Redirects after login use `safeRedirectPath` to reject absolute/open redirects.
- Password reset returns a generic success response to avoid disclosing account existence.
- Restrict Auth authorized domains and configure rate limits, SMTP/templates, and API-key restrictions in Firebase Console.

## Firestore and application authorization

- `firestore.rules` denies unrecognized collections and direct writes to domain entities. Tasks—including create/delete—must pass the authenticated Server Action and Admin adapter path so UI callers cannot bypass task validation, audit logging or notifications.
- Task definition fields, dates, priority, team assignment, and assignee require task/project management grants. The assigned researcher can accept a task, update permitted progress/work notes, submit immutable versions and see only their team-scoped work. Task status transitions are checked against the shared policy; formal approval/revision/rejection is recorded in immutable review records.
- Team, team-membership, milestone, task, document, submission, review and deliverable queries are filtered by the caller's active project/team membership. Private submissions are visible to their researcher and authorized task reviewers/managers; a project reviewer cannot see another team's task merely by holding a project-level review grant.
- Firebase Admin bypasses Rules, so the adapter and each domain Server Action repeat the relevant authorization and validation checks. Read DTOs normalize old task labels (`todo → assigned`, `review → under_review`, `rejected → cancelled`) and old priority `critical → urgent`; migration runs emit explicit warnings for these mappings.
- Activity records are server-written and not mutable through direct client Rules. Multi-document workflow operations for submissions/reviews use transactions; generic adapter activity writes follow successful entity mutations and are not a single atomic transaction.
- Notifications are readable only by their `user_id`; direct updates can only acknowledge `read_at`.

## Scheduled deadline notifications

The Node 22 Firebase Functions package runs `scheduledDeadlineNotifications` daily at 08:00 in `APP_TIMEZONE` (UTC if unset). It scans active task states for tasks due tomorrow and already overdue, paginates through results, and sends in-app notifications only if the assignee remains an active project member and (for team tasks) an active member of an active team. Notification IDs are deterministic by type/task/assignee/due date, so retries do not reset read state or create duplicates. The scheduler does not send email, push notifications, or notify reviewers; it requires Cloud Scheduler/Cloud Functions deployment and a billable Firebase/Google Cloud project. This function was added to source; it was not deployed as part of this work.

## Storage

- Keep the Firebase bucket private. Allowed research file types are validated by extension and MIME mapping; the signed POST policy binds content type, object path and a maximum size of 50 MB.
- Upload reservations bind the document ID, user UID, project, storage path, token, pending status and expiry. Finalization verifies the uploaded object's metadata against that reservation before creating the document record; abandoned uploads can be removed only through the same user's unclaimed reservation.
- Download URLs are issued only after the document record and the user's explicit/team/role-based access are checked, and expire within five minutes.
- Do not reuse or publish signed URLs as permanent links. Set bucket CORS only for trusted application origins and needed methods/headers.
- File deletion checks ownership/permission and removes metadata and object through authorized server actions.

## Operational controls and remaining limits

- Store Firebase Admin service-account credentials only in server-side secret storage or use Application Default Credentials on Google Cloud. Never prefix Admin secrets with `NEXT_PUBLIC_` or commit them.
- The public Firebase web API key is not an Admin credential; still restrict it to required APIs and monitor quotas.
- Before deploying Rules, indexes or Functions, back up and inspect the target project. Do not assume this local checkout is connected to production.
- Keep the old Supabase environment available until any independent data migration is validated. This branch does not migrate or delete old data.
- Run `npm test`, `npm run test:migration`, `npm run typecheck`, `npm run test:firebase`, `npm run lint`, `npm run format:check`, `npm --prefix functions run lint` and `npm run build` before staging rollout.
- Deadline helper behavior is unit-tested. The scheduled Function source has syntax validation but has not yet been exercised in the Firebase Functions emulator or deployed to a billable staging project.
