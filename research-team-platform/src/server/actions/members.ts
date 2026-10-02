"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError, mapDatabaseError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/env.server";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions/catalog";
import {
  evaluateMemberAdd,
  evaluateMemberManage,
  evaluateMemberRemove,
  evaluatePermissionChange,
  evaluateRoleChange,
} from "@/lib/permissions/policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidField } from "@/lib/validation/common";
import { addMemberSchema, permissionsSchema, updateMemberSchema } from "@/lib/validation/member";
import { assertProjectAccess, assertProjectPermission } from "@/server/access";
import { parseInput, runAction, unwrap, unwrapMaybe } from "@/server/action";

function revalidateTeamPaths(projectId: string) {
  revalidatePath("/team");
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** Membership row of the target, read with the caller's session. */
async function loadTarget(projectId: string, userId: string) {
  const supabase = await createSupabaseServerClient();
  const member = unwrapMaybe(
    await supabase
      .from("project_members")
      .select("user_id, role, status")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
  );
  if (!member) throw new AppError("MEMBER_NOT_FOUND");
  return { supabase, member };
}

export async function addMemberAction(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ status: "added" | "invited"; email: string }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const values = parseInput(addMemberSchema, input);
    const access = await assertProjectPermission(id, "members.add");
    const decision = evaluateMemberAdd(access, values.role);
    if (!decision.ok) throw new AppError(decision.code);

    const supabase = await createSupabaseServerClient();
    const attempt = await supabase.rpc("add_project_member", {
      p_project_id: id,
      p_email: values.email,
      p_role: values.role,
    });

    if (!attempt.error) {
      revalidateTeamPaths(id);
      return { status: "added" as const, email: values.email };
    }
    if (mapDatabaseError(attempt.error) !== "USER_NOT_FOUND") throw attempt.error;

    // No account yet: invite by e-mail (service role), then add the new user
    // with the caller's own session so the RPC re-authorizes and audits it.
    const admin = createSupabaseAdminClient();
    if (!admin) throw new AppError("INVITE_UNAVAILABLE");

    const headerStore = await headers();
    const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
    const origin = host ? `${headerStore.get("x-forwarded-proto") ?? "https"}://${host}` : null;
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(values.email, {
      redirectTo: `${getSiteUrl(origin)}/auth/callback?next=/reset-password`,
    });
    if (inviteError) {
      console.error("[members] invitation failed", inviteError.message);
      throw new AppError(inviteError.status === 429 ? "RATE_LIMITED" : "UNEXPECTED");
    }

    unwrap(await supabase.rpc("add_project_member", { p_project_id: id, p_email: values.email, p_role: values.role }));
    revalidateTeamPaths(id);
    return { status: "invited" as const, email: values.email };
  });
}

export async function updateMemberAction(
  projectId: string,
  userId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const targetId = parseInput(uuidField, userId);
    const values = parseInput(updateMemberSchema, input);
    const access = await assertProjectPermission(id, "members.manage");
    const { supabase, member } = await loadTarget(id, targetId);

    const target = { userId: member.user_id, role: member.role };
    const decision = values.role
      ? evaluateRoleChange(access, target, values.role)
      : evaluateMemberManage(access, target);
    if (!decision.ok) throw new AppError(decision.code);

    unwrap(
      await supabase.rpc("update_project_member", {
        p_project_id: id,
        p_user_id: targetId,
        p_role: values.role,
        p_status: values.status,
        p_reset_permissions: values.resetPermissions ?? true,
      }),
    );
    revalidateTeamPaths(id);
    return null;
  });
}

export async function removeMemberAction(projectId: string, userId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const targetId = parseInput(uuidField, userId);
    const access = await assertProjectPermission(id, "members.remove");
    const { supabase, member } = await loadTarget(id, targetId);

    const decision = evaluateMemberRemove(access, { userId: member.user_id, role: member.role });
    if (!decision.ok) throw new AppError(decision.code);

    unwrap(await supabase.rpc("remove_project_member", { p_project_id: id, p_user_id: targetId }));
    revalidateTeamPaths(id);
    return null;
  });
}

export async function setMemberPermissionsAction(
  projectId: string,
  userId: string,
  input: unknown,
): Promise<ActionResult<{ permissions: PermissionKey[] }>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const targetId = parseInput(uuidField, userId);
    const { permissions } = parseInput(permissionsSchema, input);
    const access = await assertProjectAccess(id);
    const { supabase, member } = await loadTarget(id, targetId);

    const currentRows = unwrap(
      await supabase.from("user_permissions").select("permission_key").eq("project_id", id).eq("user_id", targetId),
    );
    const current = new Set(currentRows.map((row) => row.permission_key).filter(isPermissionKey));
    const decision = evaluatePermissionChange(
      access,
      { userId: member.user_id, role: member.role },
      current,
      new Set(permissions),
    );
    if (!decision.ok) throw new AppError(decision.code);

    const result = unwrap(
      await supabase.rpc("set_member_permissions", {
        p_project_id: id,
        p_user_id: targetId,
        p_permissions: permissions,
      }),
    );
    revalidateTeamPaths(id);
    return { permissions: (result ?? []).filter(isPermissionKey) };
  });
}
