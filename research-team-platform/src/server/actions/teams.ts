"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { optionalUuidField, uuidField } from "@/lib/validation/common";
import { linkMemberSchema, teamMemberSchema, teamSchema } from "@/lib/validation/task";
import { z } from "zod";
import { parseInput, runAction, unwrap } from "@/server/action";
import { requireCurrentProfile } from "@/server/auth";

/**
 * Team and role administration. Every operation is a Director-only database
 * function (it re-checks the caller and writes the audit entry); the check
 * here only produces an early, friendly error.
 */
async function requireDirector() {
  const profile = await requireCurrentProfile();
  if (!profile.isDirector) throw new AppError("PERMISSION_DENIED");
  return createSupabaseServerClient();
}

function revalidateTeams() {
  revalidatePath("/teams", "layout");
  revalidatePath("/projects", "layout");
  revalidatePath("/tasks");
  revalidatePath("/workspace");
}

export async function createTeamAction(input: unknown): Promise<ActionResult<{ teamId: string }>> {
  return runAction(async () => {
    const values = parseInput(teamSchema, input);
    const supabase = await requireDirector();
    const teamId = unwrap(
      await supabase.rpc("create_team", { p_name: values.name, p_description: values.description }),
    );
    revalidateTeams();
    return { teamId };
  });
}

export async function updateTeamAction(teamId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, teamId);
    const values = parseInput(teamSchema, input);
    const supabase = await requireDirector();
    unwrap(
      await supabase.rpc("update_team", { p_team_id: id, p_name: values.name, p_description: values.description }),
    );
    revalidateTeams();
    return null;
  });
}

export async function saveTeamMemberAction(
  teamId: string,
  memberId: string | null,
  input: unknown,
): Promise<ActionResult<{ memberId: string }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, teamId);
    const existing = parseInput(optionalUuidField, memberId);
    const values = parseInput(teamMemberSchema, input);
    const supabase = await requireDirector();
    const saved = unwrap(
      await supabase.rpc("upsert_team_member", {
        p_team_id: id,
        // null creates a new roster entry (the generated type does not mark the parameter nullable).
        p_member_id: existing as string,
        p_display_name: values.displayName,
        p_member_code: values.memberCode,
        p_job_title: values.jobTitle,
        p_role: values.role,
        p_invite_email: values.inviteEmail ?? undefined,
      }),
    );
    revalidateTeams();
    return { memberId: saved };
  });
}

export async function linkTeamMemberAction(memberId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, memberId);
    const { email } = parseInput(linkMemberSchema, input);
    const supabase = await requireDirector();
    unwrap(await supabase.rpc("link_team_member", { p_member_id: id, p_email: email }));
    revalidateTeams();
    return null;
  });
}

const memberStatusSchema = z.object({ status: z.enum(["active", "inactive"], "validation.invalid") });

export async function setTeamMemberStatusAction(memberId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, memberId);
    const { status } = parseInput(memberStatusSchema, input);
    const supabase = await requireDirector();
    unwrap(await supabase.rpc("set_team_member_status", { p_member_id: id, p_status: status }));
    revalidateTeams();
    return null;
  });
}

export async function removeTeamMemberAction(memberId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, memberId);
    const supabase = await requireDirector();
    unwrap(await supabase.rpc("remove_team_member", { p_member_id: id }));
    revalidateTeams();
    return null;
  });
}

export async function setProjectTeamAction(projectId: string, teamId: string | null): Promise<ActionResult<null>> {
  return runAction(async () => {
    const project = parseInput(uuidField, projectId);
    const team = parseInput(optionalUuidField, teamId);
    const supabase = await requireDirector();
    // null unlinks the project (the generated type does not mark the parameter nullable).
    unwrap(await supabase.rpc("set_project_team", { p_project_id: project, p_team_id: team as string }));
    revalidateTeams();
    return null;
  });
}

export async function setDirectorAction(userId: string, isDirector: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, userId);
    const value = parseInput(z.boolean(), isDirector);
    const supabase = await requireDirector();
    unwrap(await supabase.rpc("set_user_director", { p_user_id: id, p_is_director: value }));
    revalidatePath("/", "layout");
    return null;
  });
}
