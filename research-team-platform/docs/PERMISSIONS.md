# D. Permission model

## Concepts

| Concept                   | Meaning                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Membership**            | Access is always per project: a row in `project_members (project_id, user_id, role, status)`. A user can be a manager in one project and a reviewer in another.                                                                  |
| **Role**                  | `owner`, `manager`, `member`, `reviewer`. A role is a _label_ and a _template_: when a member is added (or their role changes) the role's template pre-fills their permissions. It is **not** what the system checks afterwards. |
| **Effective permissions** | The rows in `user_permissions` for that member and project. This is what every check uses, so two members with the same role can have different permissions.                                                                     |
| **Owner**                 | Exactly one per project (created with it, transferable). The owner implicitly holds every permission; owner grants are never stored and cannot be edited.                                                                        |
| **Access gate**           | `project.view`. Without it a member has no effective permission in the project at all, whatever else is stored.                                                                                                                  |
| **Suspension**            | `status = 'suspended'` removes every permission immediately (including for open sessions) without deleting the member's grants, so reactivation restores them.                                                                   |
| **Platform flags**        | `profiles.is_platform_admin` (system owner) and `profiles.can_create_projects`. Only platform admins change them; the first admin is bootstrapped from `PLATFORM_ADMIN_EMAILS` or `npm run admin:promote`.                       |

The single function every rule goes through:

```text
member_has_permission(project, user, key) =
     membership exists AND status = 'active'
 AND ( role = 'owner'
       OR ( 'project.view' ∈ grants AND key ∈ grants ) )
```

## Permission catalog

24 keys, defined once in `supabase/migrations/20261001000200_permission_catalog.sql`
and mirrored in `src/lib/permissions/catalog.ts` (a unit test fails if they
diverge). Columns O / M / Mb / R show the default templates for Owner,
Manager, Member and Reviewer.

| Key                   | Category       | Grants                                                              |  O  |  M  | Mb  |  R  |
| --------------------- | -------------- | ------------------------------------------------------------------- | :-: | :-: | :-: | :-: |
| `project.view`        | Project        | Open the project at all (gate)                                      |  ✓  |  ✓  |  ✓  |  ✓  |
| `project.edit`        | Project        | Edit name, description, goal, status, dates                         |  ✓  |  ✓  |     |     |
| `project.delete`      | Project        | Delete the project                                                  |  ✓  |     |     |     |
| `tasks.view`          | Tasks          | See every task incl. private work (without it: only own / assigned) |  ✓  |  ✓  |     |  ✓  |
| `tasks.create`        | Tasks          | Create tasks                                                        |  ✓  |  ✓  |     |     |
| `tasks.edit`          | Tasks          | Supervise: edit any task, plan, schedule, deadline, block/cancel    |  ✓  |  ✓  |     |     |
| `tasks.edit_own`      | Tasks          | Edit the definition of tasks **they created** (never the schedule)  |  ✓  |  ✓  |     |     |
| `tasks.edit_assigned` | Tasks          | Execute tasks **assigned to them**: start, progress, notes, submit  |  ✓  |  ✓  |  ✓  |     |
| `tasks.assign`        | Tasks          | Set / change the assignee                                           |  ✓  |  ✓  |     |     |
| `tasks.review`        | Tasks          | Review, approve, request revisions, mark as completed (publish)     |  ✓  |  ✓  |     |  ✓  |
| `tasks.delete`        | Tasks          | Delete tasks                                                        |  ✓  |  ✓  |     |     |
| `documents.view`      | Documents      | List and download files                                             |  ✓  |  ✓  |  ✓  |  ✓  |
| `documents.upload`    | Documents      | Upload files                                                        |  ✓  |  ✓  |  ✓  |     |
| `documents.edit`      | Documents      | Edit document title / description                                   |  ✓  |  ✓  |     |     |
| `documents.delete`    | Documents      | Delete documents and their files                                    |  ✓  |  ✓  |     |     |
| `comments.create`     | Comments       | Comment on the project and visible tasks; edit own comments         |  ✓  |  ✓  |  ✓  |  ✓  |
| `comments.delete`     | Comments       | Delete other people's comments (own comments can always be deleted) |  ✓  |  ✓  |     |     |
| `team.view`           | Team           | See members, roles and permissions                                  |  ✓  |  ✓  |  ✓  |  ✓  |
| `members.add`         | Team           | Add existing users / invite by e-mail                               |  ✓  |  ✓  |     |     |
| `members.remove`      | Team           | Remove members                                                      |  ✓  |  ✓  |     |     |
| `members.manage`      | Team           | Change roles, suspend / reactivate                                  |  ✓  |  ✓  |     |     |
| `permissions.manage`  | Team           | Edit the permission matrix of members                               |  ✓  |     |     |     |
| `activity.view`       | Administration | Read the project's full activity log                                |  ✓  |     |     |     |
| `data.export`         | Administration | Export project data (tasks as CSV, the project as JSON)             |  ✓  |  ✓  |     |     |

The role templates live in `role_permissions` and can be tuned without code
changes; existing members keep their effective permissions.

## Rules by area

### Projects

- Creating a project requires `can_create_projects` (or platform admin); the
  creator becomes its owner. Projects are created only through the
  `create_project` RPC (no direct `INSERT` grant).
- `project.edit` → update the editable columns only (column-level grants).
- `project.delete` → delete; cascades to members, grants, tasks, documents and
  comments. The audit log keeps the history; the app removes the files.
- Ownership transfer (`transfer_project_ownership`): owner only, to an active
  member, who becomes owner; the former owner becomes a manager.

### Organization roles (NestHire)

Directors (`profiles.is_director`) hold every permission in every project;
Team Leads get a fixed set in their team's projects; Team Members get the
member template. Teams, rosters and roles are changed only by Directors. See
[NESTHIRE.md](NESTHIRE.md) for the role model, scheduling, workflow and the
private → team publication; the table below is the task-level summary.

### Tasks

Row access is decided by RLS, field changes by the `tasks_before_update`
trigger (rules of the NestHire upgrade):

| Change                                                                                  | Allowed when                                                                                                         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| See the task row (and its submissions, reviews, comments)                               | `tasks.view` (supervisors), or the user created it / is responsible for it — other members' work is **private**      |
| See the published result                                                                | members of the task's team (or of the project when it has no team), via `task_publications` only                     |
| Create                                                                                  | `tasks.create`; assigning to someone else needs `tasks.assign`; plan, schedule or a manual task ID need `tasks.edit` |
| Edit definition (title, description, instructions, expected output, criteria, priority) | `tasks.edit`, or `tasks.edit_own` on tasks the user created                                                          |
| Plan & schedule (month, week, start, duration, deadline)                                | `tasks.edit` only — members never                                                                                    |
| Progress / work notes                                                                   | the responsible member (`tasks.edit_assigned`) or `tasks.edit`                                                       |
| Start / resume                                                                          | the responsible member or `tasks.edit` (not while predecessors are unfinished)                                       |
| Block, unblock, cancel, re-open                                                         | `tasks.edit`                                                                                                         |
| Submit / resubmit (new version)                                                         | the responsible member, through `submit_task()`                                                                      |
| Review, approve, request revision, mark as completed                                    | `tasks.review` through the workflow functions; no user may review, approve or publish their own work                 |
| Change assignee                                                                         | `tasks.assign` (the new assignee must be an active member)                                                           |
| Delete                                                                                  | `tasks.delete`                                                                                                       |
| Task ID, project, team, creator, visibility, workflow dates                             | Never (no column privilege; `IMMUTABLE_FIELD`)                                                                       |
| Edit a completed task                                                                   | Never (closed record)                                                                                                |

Errors surface as «لا يمكنك تعديل هذه المهمة.» (`TASK_EDIT_FORBIDDEN`) or
«ليس لديك صلاحية لتنفيذ هذه العملية.» for the other cases.

### Documents and files

- Files live at `<project_id>/<document_id>/<file>` in the private
  `project-documents` bucket (50 MB, MIME allow-list, no overwrite).
- Upload: `documents.upload` (storage `INSERT` policy on the project folder,
  then a `documents` row whose existence check, size and MIME type come from
  Storage, not from the client).
- Download / signed URLs: `documents.view`.
- Edit title/description: `documents.edit`. Delete row and file:
  `documents.delete`.
- The uploader may discard their own upload only while no document row
  references it (a failed second upload step).

### Comments

- Add: `comments.create`; task comments only on tasks the user can see.
- Edit: only the author (while holding `comments.create`).
- Delete: the author, or anyone with `comments.delete`.
- Edits and deletions are audited with the previous content.

### Team, roles and permissions

| Operation                        | Requires             | Additional rules                                                                                                                                                                                                                                  |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add member / invite              | `members.add`        | Role must rank **below** the actor's (owner: any non-owner role). The new member gets the role template **limited to permissions the actor holds**.                                                                                               |
| Change role, suspend, reactivate | `members.manage`     | Not on the owner, not on oneself, target must rank below the actor, new role must rank below the actor.                                                                                                                                           |
| Remove member                    | `members.remove`     | Same rank rules; their tasks are un-assigned automatically.                                                                                                                                                                                       |
| Edit permissions                 | `permissions.manage` | Not on the owner (`CANNOT_MODIFY_OWNER`), not on oneself (`CANNOT_MODIFY_SELF`), target must rank below the actor (`INSUFFICIENT_RANK`), and a non-owner can only grant **or revoke** permissions they hold themselves (`PERMISSION_ESCALATION`). |

Ranks: owner 100 > manager 50 > member = reviewer 10.

These rules make privilege escalation impossible by construction: nobody can
raise their own permissions, and nobody can hand out a permission they do not
already have.

### Activity log

- Written only by the database (triggers / RPCs); no client can insert,
  update or delete entries (no grants, plus a trigger that blocks
  `UPDATE`/`DELETE`/`TRUNCATE` even for privileged roles).
- Read: `activity.view` → the project's full log (the owner always has it).
  Everyone can see their own actions. Platform admins also see platform-level
  entries and the history of deleted projects.
- Permission changes are logged with old and new values per key, e.g.
  `{"tasks.delete": false} → {"tasks.delete": true}`.

## Where each rule is enforced

| Rule                     | Database (authoritative)                                                                                                                                     | Server (Next.js)                                                           | UI                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------ |
| Project isolation        | RLS on every table via `private.project_ids_with_permission` / `has_permission`; composite FKs                                                               | `getProjectAccess` in the project layout                                   | Only member projects are listed            |
| Task field rules         | `tasks_before_insert` / `tasks_before_update`, column grants                                                                                                 | `evaluateTaskCreate` / `evaluateTaskUpdate` (same rules, precise messages) | Disabled fields, allowed statuses only     |
| Membership & permissions | `add_project_member`, `update_project_member`, `remove_project_member`, `set_member_permissions` (SECURITY DEFINER, explicit checks); no direct write grants | `evaluateMemberManage`, `evaluatePermissionChange`                         | Locked checkboxes with an explanation      |
| Files                    | Storage policies on `storage.objects`, `documents_before_insert`                                                                                             | Path built server-side; type/size validated                                | Upload button only with `documents.upload` |
| Audit                    | Triggers + immutability trigger                                                                                                                              | —                                                                          | Activity pages                             |

Tests: `supabase/tests/database/*.test.sql` (266 pgTAP assertions),
`tests/integration/api-security.test.ts` (direct API attacks with real user
sessions) and `tests/unit/permissions-policy.test.ts` (server/UI policy).

## Adding a permission

1. Add the key to `public.permissions` (new migration) and to the templates
   that should include it.
2. Add it to `PERMISSION_KEYS` / `ROLE_TEMPLATES` in
   `src/lib/permissions/catalog.ts` and to both dictionaries
   (`permissions.items`). The consistency unit test fails until both sides
   match.
3. Use it in the relevant RLS policy / trigger / RPC, then in
   `src/lib/permissions/policy.ts` for the UI.
4. Add pgTAP assertions for the new rule.
