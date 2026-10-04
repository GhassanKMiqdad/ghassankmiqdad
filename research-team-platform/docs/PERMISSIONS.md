# Permission model

## Membership and effective access

Access is granted per project through `project_members/{projectId_uid}`. A membership contains a role, active/suspended status, and an effective permission array. Every non-owner access also requires the `project.view` gate. Suspended memberships grant no project access. The project owner is treated as having all supported permissions.

Role templates and the permission catalog live in `src/lib/permissions/catalog.ts`. The shared pure policy functions are in `src/lib/permissions/policy.ts`; the server adapter applies the same checks before Admin SDK operations. A user cannot change their own role or permissions through the app.

## Current task visibility and workflow

| Operation                        | Current rule                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| View a project                   | Active membership with `project.view`                                                                              |
| View all project tasks           | Requires `tasks.view`                                                                                              |
| View a task without `tasks.view` | Only the task assigned to the caller; a reviewer with `tasks.review` can see tasks in `review`                     |
| Create task                      | Requires `tasks.create`; assignment to another member also requires `tasks.assign`                                 |
| Change definition                | Requires `tasks.edit`; includes title, instructions, expected output, required deliverables, priority and due date |
| Update progress/work notes       | Assigned member only, with `tasks.update_progress` / `tasks.add_work_notes`                                        |
| Start/resume work                | Assigned member only; allowed transitions are checked by the shared policy                                         |
| Submit for review                | Assigned member only, from `in_progress`, with `tasks.submit`                                                      |
| Review                           | `tasks.review` permits decisions on items in the review state; assigned researchers cannot approve their own task  |
| Reassign                         | Requires `tasks.assign`; the new assignee must be an active project member                                         |
| Delete                           | Requires `tasks.delete`                                                                                            |

Current statuses include `todo`, `in_progress`, `review`, `revision_required`, `completed`, and `rejected`. The revision-request cycle is represented as a status transition. Separate versioned submission records and per-review feedback records are not part of the current schema.

## Documents and private files

- Files are stored under a server-chosen `<projectId>/<documentId>/<sanitized-file-name>` path.
- Upload requires `documents.upload`; the signed POST policy fixes the exact path and MIME type and caps the body at 50 MB.
- A new file is private to its uploader by default. The `authorized_users` metadata controls explicit shares; managers with the appropriate project/document visibility permissions may access project-managed files.
- Signed downloads are issued only after a current authorization check and expire quickly.
- Editing metadata requires `documents.edit`. Changing explicit sharing is restricted to a user with `team.view`; deleting requires `documents.delete`.

## Other resources

- Project/task comments require `comments.create`; edits/deletes follow authorship and `comments.delete` rules.
- Full activity history requires `activity.view`; a user can also view their own logged events.
- Notifications are scoped to their recipient and can only be marked read by that recipient.
- Project membership, permission catalog, and platform-admin flags are server-managed. Never add unrestricted client writes for these records.

## Enforcement layers

1. **Server Actions/queries:** authenticate the Firebase session, validate input, load current membership, filter private rows, enforce field-level rules, and write audit records.
2. **Firebase Rules:** deny unauthenticated/unknown access and enforce direct-client resource boundaries. See `firestore.rules` and `storage.rules`.
3. **UI:** hides unavailable controls but is not relied upon for privacy.

The Admin SDK bypasses Firebase Rules, so any new server-side Admin code must repeat authorization checks. Emulator coverage is in `tests/firebase/rules.test.ts`; shared policy coverage is in `tests/unit/permissions-policy.test.ts`.
