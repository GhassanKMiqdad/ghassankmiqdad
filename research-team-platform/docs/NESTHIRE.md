# G. NestHire — task scheduling & execution control

This document describes the NestHire upgrade of the platform: the explicit
role model, task IDs, scheduling, the execution workflow and the
PRIVATE → TEAM publication rule. Every rule below is enforced by the database
(RLS, column privileges, `BEFORE` triggers and `SECURITY DEFINER` functions);
the UI only hides what the database would reject anyway.

Migrations: `supabase/migrations/20261007000100…000500_nesthire_*.sql` and
`20261008000100_workflow_security_hardening.sql` (section 9).
Tests: `supabase/tests/database/03_tasks_permissions.test.sql`,
`08_nesthire_workflow.test.sql`, `09_security_hardening.test.sql`, the _NestHire_ block of
`tests/integration/api-security.test.ts`, `tests/unit/schedule.test.ts`.

## 1. Organization structure and roles

```text
Organization
└── Director (profiles.is_director)          — organization-wide authority
    └── Team (teams)                         — e.g. "NestHire Team"
        ├── Team Lead  (team_members.role = team_lead)
        ├── Team Members (team_members.role = team_member)
        └── Projects linked to the team (projects.team_id) → Tasks
```

| Role            | Authority                                                                                                                                                                                              | Where it is enforced                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Director**    | Every permission in every project (like an owner), all data and the full audit log, teams, rosters, project ↔ team links, Director role, review/approve/publish other people's work (never their own). | `private.member_has_permission`, `project_ids_with_permission`, `member_role`, `get_my_project_access`, Director RPCs |
| **Team Lead**   | In the projects of their team only: create, assign, schedule, edit, review, approve, request revisions, MARK AS COMPLETED. No member, role or permission management, no other teams.                   | Fixed permission set `private.team_lead_permissions()` synchronized into the team's projects                          |
| **Team Member** | Their own tasks only: start, progress, work notes, submit / resubmit, read their feedback; read the team's published results.                                                                          | Member template (`project.view`, `tasks.edit_assigned`, documents, comments, `team.view`) + RLS                       |

- Role transitions happen only through Director functions
  (`set_user_director`, `upsert_team_member`, `set_team_member_status`,
  `remove_team_member`, `set_project_team`) or the trusted bootstrap
  (`bootstrap_platform_admin`, service role / SQL editor). Each one re-checks
  the caller and writes an audit entry. There is no client write privilege on
  `profiles.is_director`, `teams`, `team_members` or invitations.
- The last Director cannot be removed (`LAST_DIRECTOR`).
- **Rosters drive membership.** Linking an account to a roster entry (or a
  project to a team) adds the person to the team's projects with the matching
  role (Team Lead → manager role with the Team Lead permission set, Team
  Member → member template). Deactivating or removing a roster entry suspends
  that access. A roster entry can carry an invitation e-mail: when that person
  confirms an account with it, the entry is linked automatically.
- Members no longer get `tasks.view` / `tasks.create` / `tasks.edit_own` by
  default. The upgrade migration revokes `tasks.view` from existing
  "member" role holders (audited) so that private work stays private.

## 2. Task ID

`M<month>-<member code>-<week>-<sequence>`, e.g. **M01-GH-01-01** — generated
by `private.next_task_code()` from the planning month, the responsible
member's code in the task's team (`NA` when unassigned) and the planning week
(`00` when none). A supervisor may type an existing ID instead (to preserve
IDs from an existing plan). IDs are unique, immutable (no update privilege,
trigger check), searchable in every list and used in audit entries,
notifications, exports and publications.

## 3. Scheduling

| Field                                         | Meaning                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planning_month`, `planning_week`             | The plan (Month 1, Week 1–5) — separate from actual dates                                                                                         |
| `planned_start_at`                            | Planned start (date and time)                                                                                                                     |
| `planned_duration` + `duration_unit`          | Duration in hours, days or weeks; normalized to `planned_duration_minutes`                                                                        |
| `due_at`                                      | Deadline = start + duration, **calculated by the database** unless `due_at_overridden`                                                            |
| `actual_start_at`                             | Set by the database the first time the task moves to IN_PROGRESS                                                                                  |
| `submitted_at`, `approved_at`, `completed_at` | Set by the workflow functions                                                                                                                     |
| `public.schedule_status(task)` (computed)     | `unscheduled`, `not_started`, `scheduled`, `active`, `due_soon` (< 24 h), `overdue`, `completed`, `cancelled` — evaluated with the database clock |

Only supervisors (`tasks.edit`) can change the plan or the schedule; a
member's attempt fails with «لا يمكنك تعديل هذه المهمة.». Nothing invents
dates: a task without start or deadline shows **SCHEDULE NOT YET DEFINED**.
Form values are entered in the application time zone (`APP_TIMEZONE`) and
stored as instants.

## 4. Lifecycle

```text
NOT_STARTED ──(start planned)──► SCHEDULED ──(member starts)──► IN_PROGRESS
     ▲                                                              │ submit_task (v1)
     │ re-open                                                      ▼
 CANCELLED ◄── cancel ── (any open state)                       SUBMITTED
                                                                    │ start_task_review
 BLOCKED ◄─► (supervisor)                                           ▼
                                                              UNDER_REVIEW
                                   review_task(revision)  ┌─────────┴─────────┐ review_task(approve)
                                                          ▼                   ▼
                                                 REVISION_REQUIRED        APPROVED
                                                          │ submit_task (v2…)  │ complete_task  (MARK AS COMPLETED)
                                                          └──► SUBMITTED       ▼
                                                                           COMPLETED  (visibility = TEAM)
```

- Direct updates may only start/resume (responsible member or supervisor),
  block/unblock, cancel and re-open (supervisors)
  — `private.task_transition_allowed`. SUBMITTED, UNDER_REVIEW,
  REVISION_REQUIRED, APPROVED and COMPLETED are reachable **only** through
  the workflow functions.
- A task with unfinished predecessors (`task_dependencies`) cannot start
  (`TASK_BLOCKED`); cycles are rejected.
- Every submission is a new row in `task_submissions` (version 1, 2, …);
  nothing is overwritten. Every review is a row in `task_reviews` with its
  comment, required changes, additional instructions and optional new
  deadline.
- `review_task` decides only on a version that is UNDER_REVIEW (the latest
  one); `complete_task` publishes only the latest version, which must be
  APPROVED and carry an approving review.
- Nobody reviews, approves or completes their own task, nor a version they
  submitted themselves (also after a reassignment) — **Directors included**
  (`SELF_REVIEW_FORBIDDEN`). A Director's own work needs another reviewer
  (a Team Lead, a reviewer or another Director).
- A completed task is a closed record.

## 5. PRIVATE → TEAM publication

While a task is not completed it is **private**: only supervisors
(`tasks.view`, i.e. Director / Team Lead / reviewers) and the responsible
member can read the task row, its submissions, reviews and comments.

`complete_task` (the **MARK AS COMPLETED** button) requires an APPROVED task
and then, in one transaction:

1. marks the latest approved submission as the official final result,
2. sets `status = completed`, `completed_at`, `visibility = team`, `published_at`,
3. inserts a sanitized row in `task_publications` — task ID, title,
   responsible name and title, final result, approved deliverable links,
   completion date, team-visible comment,
4. notifies the team, and writes `task.completed` + `task.published` audit entries.

Team members read **only** `task_publications` (RLS: members of the task's
team; for a project without a team, its members). They never read the task
row, drafts, earlier versions, review notes or private notes. `visibility`
and every workflow timestamp have no client write privilege, so the
publication cannot be forged.

## 6. Audit and notifications

Audit actions written by the database: `task.created`, `task.updated`,
`task.assigned`, `task.schedule_changed`, `task.progress_updated`,
`task.scheduled`, `task.started`, `task.resumed`, `task.submitted`,
`task.resubmitted`, `task.review_started`, `task.revision_requested`,
`task.approved`, `task.completed`, `task.published`, `task.blocked`,
`task.unblocked`, `task.cancelled`, `task.reopened`,
`task.dependency_added/removed`, `team.*`, `project.team_changed`,
`platform_user.director_changed`, plus role and permission changes caused by
roster synchronization (reason `team_sync` / `team_role`).

Notifications (`notifications`, own rows only): task assigned, work submitted
(task creator and Team Leads), revision requested / approved (responsible
member), result published (the team).

## 7. Screens

| Screen        | Who                             | Content                                                                                                                                                                                                                               |
| ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard     | everyone, role-aware            | Director / Team Lead: today, this week, overdue, due within 24 h, awaiting review, ready to publish, priority and member overview. Member: my tasks, my schedule, my progress, latest team results.                                   |
| Tasks         | everyone                        | Task ID, task, responsible + title, plan, priority, status + schedule signal, start, deadline; filters for month, week, date range, member, team, project, priority, status, overdue / due soon / unscheduled; search by ID or title. |
| Assign a task | supervisors                     | Sections Basic / Assignment / Scheduling / Priority / Expected result, live deadline preview, confirmation summary.                                                                                                                   |
| Task detail   | supervisors, responsible        | Workflow actions, instructions, execution (progress, notes), versioned submissions and reviews, timeline (planned vs actual), predecessors, audit history.                                                                            |
| Schedule      | everyone                        | Month and week calendar of starts and deadlines; unscheduled count.                                                                                                                                                                   |
| Team results  | team members                    | Published final results only.                                                                                                                                                                                                         |
| Teams         | Director (edit), members (read) | Rosters with codes and titles, account linking, project links, Director role.                                                                                                                                                         |
| Reports       | supervisors                     | Planned vs actual per member: completed, on time, overdue, revisions, submissions, average start / delivery delay.                                                                                                                    |
| Notifications | everyone                        | Bell with unread count and the notification list.                                                                                                                                                                                     |

## 8. Bringing the real NestHire team in

1. Apply the migrations (`npx supabase db push`, or the SQL files in order).
2. Run `scripts/sql/nesthire-team.sql` once in the SQL Editor: it creates the
   team with the nine roster entries and links GH to the Director's account.
3. Run `scripts/sql/nesthire-month-01.sql` once: it creates the project
   **NestHire**, links it to the team and loads the 66 month-1 tasks with
   their exact IDs, responsible members, planning weeks, priorities,
   descriptions, expected outputs, completion criteria, predecessors and
   schedule (Month 1 starts Sunday 11 October 2026, working days Sunday to
   Thursday, start 09:00 Asia/Gaza). The script verifies that no task starts
   before one of its predecessors is due. Both scripts are idempotent.
4. In the app: **Teams → NestHire Team → Edit member** and add each person's
   e-mail. They are linked as soon as they sign up and confirm that e-mail.

### Planning for members without an account

A task can be assigned to a **roster entry** (`tasks.responsible_member_id`)
before the person has an account — the assignment form lists those members
with the note _no account yet_. The task ID uses the roster code, the lists
show the roster name, and the task is assigned to the account automatically
(audited and notified) the moment the roster entry is linked. Choosing a
roster member is an assignment decision (`tasks.assign`).

Later months are added in the app (**Tasks → Assign a task**); type the
planned ID (e.g. `M02-AB-01-01`) to keep the plan's numbering.

## 9. Security hardening (NestHire Workspace)

Migration `20261008000100_workflow_security_hardening.sql`, tested by
`09_security_hardening.test.sql` (IDOR scenarios A–F, strict state machine,
self-approval, version privacy, private files and Storage) and by the
_NestHire_ block of `tests/integration/api-security.test.ts` (real Auth,
PostgREST and Storage API).

| Rule                                 | Enforcement                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Private task files                   | `documents.task_id`; `documents_select` = can see the task, or the file is listed in a publication the caller can read              |
| Storage objects follow the documents | `project_documents_select` reads `public.documents` with the caller's rights; unregistered objects only by their uploader           |
| Files of a version are evidence      | `task_submissions.document_ids` validated by `submit_task` (same task, own upload); `documents_task_file_guard` → `DOCUMENT_LOCKED` |
| Links are never a way to share files | `submit_task` refuses Storage API URLs (`DELIVERABLE_LINK_FORBIDDEN`); links are shown as unverified external links                 |
| Publication = sanitized boundary     | `task_publications` (summary, external links, final files); never notes, reviews, comments or earlier versions                      |
| Publication readers                  | active members of the task's project (`project.view`) and Directors                                                                 |
| Immutable records                    | `task_submissions_immutable`, `task_reviews_immutable`, `task_publications_immutable` triggers                                      |
| Former creators                      | a creator reads another member's task only while still holding `tasks.create`                                                       |
| Private task comments                | edited / deleted only while the task is visible to the caller                                                                       |

Lifecycle of a deliverable file:

```text
member uploads (signed upload URL, own folder) → documents row with task_id (task visible to: supervisors + responsible)
  → submit_task(..., p_document_ids) → file locked
  → start_task_review → review_task(approved) → complete_task
  → task_publications.document_ids = files of the final version → the team reads them (60-second signed URLs)
```

Routes: `/workspace` is the canonical home (`/dashboard`, `/nesthire` and
`/nesthire/*` redirect permanently with 308).

### Final privacy rules (migration `20261008000200_final_privacy_hardening.sql`, tests `10_final_privacy.test.sql`)

| Rule                             | Behaviour                                                                                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-review                      | Whoever is responsible for the task or submitted the version under review cannot start the review, decide on it or publish it — **every role, the Director included**.                                                                                                  |
| Reassignment — previous assignee | Loses the task entirely: row, versions, reviews, comments, files and Storage objects.                                                                                                                                                                                   |
| Reassignment — new assignee      | Reads the task instructions, the supervisors' reference files, comments written since their assignment started (`tasks.assigned_at`), and only the versions they submit themselves with the reviews of those versions. Earlier private work stays with the supervisors. |
| Previous notes                   | `work_notes` and `progress` of the previous assignee are cleared on reassignment; their values remain in the audit log (supervisors).                                                                                                                                   |
| Supervisors                      | `tasks.view` keeps the complete history.                                                                                                                                                                                                                                |
| External links                   | Well-formed https only, valid host/port, no embedded credentials, never a Storage URL. Shown as "External links": a reference, never proof of ownership, approval, privacy or safety. Internal deliverables are Storage files with a task, an uploader and RLS.         |
| Concurrency                      | `submit_task`, `start_task_review`, `review_task` and `complete_task` lock the task row (`SELECT … FOR UPDATE`) and re-check status and the latest version inside the transaction, so a stale version cannot be approved or published.                                  |

Production database path: `scripts/sql/nesthire-security-upgrade.sql`
applies `20261008000100`, `20261008000200`, and `20261008000300` in order
(equivalent to `supabase db push`) in one transaction. The `00300` migration
aligns direct-RPC link validation with the frontend and rejects malformed hosts
and out-of-range ports. `scripts/sql/nesthire-finish-live-upgrade.sql` is a
historical, obsolete script; this document does not assert whether it was run
against the current production database.
