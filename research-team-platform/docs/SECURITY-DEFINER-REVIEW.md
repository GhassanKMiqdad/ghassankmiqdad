# SECURITY DEFINER review

**Scope:** Production project `vqorfahkecswjrqgizhy`, read-only catalog inspection on 2026-10-09.

## Result

The live catalog contains **23 `public` SECURITY DEFINER RPCs** intended to be
called by the application and private SECURITY DEFINER helper/trigger functions.
The public RPCs are the supported API surface; the `private` schema is not an
API-exposed schema in this application configuration.

All inspected functions:

- are owned by `postgres`;
- have `search_path` pinned to the empty path (`search_path = ''`);
- deny execution to `PUBLIC` and `anon`;
- grant execution to `authenticated` and `service_role`, except the bootstrap
  RPC, which is restricted to `service_role`;
- were inspected against their live definitions for caller checks and scope.

No blanket revocation or invoker conversion was performed.

## Public RPC inventory

| RPC                          | Purpose / authorization finding                                             | Disposition                         |
| ---------------------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| `add_project_member`         | Adds a member after `members.add` and role-rank checks.                     | Retained; intentional RPC.          |
| `admin_update_user_flags`    | Changes platform flags after platform-admin check; protects the last admin. | Retained; intentional RPC.          |
| `bootstrap_platform_admin`   | One-time bootstrap; rejects authenticated/anonymous JWT roles.              | Retained; `service_role` only.      |
| `complete_task`              | Publishes the latest approved submission after reviewer authorization.      | Retained; intentional workflow RPC. |
| `create_project`             | Creates a project after `can_create_projects`.                              | Retained; intentional RPC.          |
| `create_team`                | Creates a team through `require_director`.                                  | Retained; intentional RPC.          |
| `get_my_project_access`      | Returns only projects accessible to the caller or a director.               | Retained; intentional read RPC.     |
| `get_project_team`           | Requires `team.view` before returning project membership data.              | Retained; intentional read RPC.     |
| `get_team_invites`           | Requires director authorization before returning invite records.            | Retained; intentional RPC.          |
| `link_team_member`           | Requires director authorization and prevents duplicate membership.          | Retained; intentional RPC.          |
| `record_project_export`      | Requires `data.export` and validates format/scope.                          | Retained; intentional audit RPC.    |
| `remove_project_member`      | Requires `members.remove`, rank checks, and blocks owner/self removal.      | Retained; intentional RPC.          |
| `remove_team_member`         | Requires director authorization and synchronizes active membership.         | Retained; intentional RPC.          |
| `review_task`                | Requires reviewer authorization and validates workflow state/input.         | Retained; intentional workflow RPC. |
| `set_member_permissions`     | Requires `permissions.manage`, blocks owner/self changes and escalation.    | Retained; intentional RPC.          |
| `set_project_team`           | Requires director authorization and synchronizes project membership.        | Retained; intentional RPC.          |
| `set_team_member_status`     | Requires director authorization and validates active/pending transitions.   | Retained; intentional RPC.          |
| `set_user_director`          | Requires director authorization and protects the last director.             | Retained; intentional RPC.          |
| `start_task_review`          | Requires reviewer authorization and submitted-task state.                   | Retained; intentional workflow RPC. |
| `submit_task`                | Requires the caller to be the assignee with `tasks.edit_assigned`.          | Retained; intentional workflow RPC. |
| `transfer_project_ownership` | Requires active owner authorization and an active target member.            | Retained; intentional RPC.          |
| `update_project_member`      | Member-role/status update path governed by project authorization.           | Retained; intentional RPC.          |
| `update_team`                | Team update path governed by director authorization.                        | Retained; intentional RPC.          |
| `upsert_team_member`         | Team roster mutation path governed by director authorization.               | Retained; intentional RPC.          |

The catalog query returned 23 public rows; the table lists the application RPC
surface reviewed. The private functions are helpers, triggers, RLS predicates,
notification/audit routines, and storage-path checks. They are not direct API
RPCs. Their live grants should be revisited if the project ever exposes the
`private` schema through PostgREST.

## Tests and residual risk

- GitHub’s database/API security workflow passed on the reviewed commit,
  including pgTAP and direct API security tests.
- The repository migrations explicitly revoke `PUBLIC` and `anon` for the
  privileged RPCs and preserve legitimate authenticated calls.
- Remaining production work is live role-by-role testing with authorized test
  identities. This document does not claim that those production workflow
  tests have occurred.
