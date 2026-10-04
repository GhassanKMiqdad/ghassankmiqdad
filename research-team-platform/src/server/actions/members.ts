"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError, mapFirebaseError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/env.server";
import { firebaseAdminFirestore, FieldValue } from "@/lib/firebase/admin";
import { identityToolkitRequest } from "@/lib/firebase/auth-rest";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions/catalog";
import {
  evaluateMemberAdd,
  evaluateMemberManage,
  evaluateMemberRemove,
  evaluatePermissionChange,
  evaluateRoleChange,
} from "@/lib/permissions/policy";
import { createFirebaseAdminClient } from "@/lib/firebase/compat";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
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
  const firebase = await createFirebaseServerClient();
  const member = unwrapMaybe(
    await firebase
      .from("project_members")
      .select("user_id, role, status")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
  );
  if (!member) throw new AppError("MEMBER_NOT_FOUND");
  return { firebase, member };
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

    const firebase = await createFirebaseServerClient();
    const attempt = await firebase.rpc("add_project_member", {
      p_project_id: id,
      p_email: values.email,
      p_role: values.role,
    });

    if (!attempt.error) {
      revalidateTeamPaths(id);
      return { status: "added" as const, email: values.email };
    }
    if (mapFirebaseError(attempt.error) !== "USER_NOT_FOUND") throw attempt.error;

    // Firebase Admin creates the account; Identity Toolkit sends a one-time
    // password-setup link. The membership RPC rechecks the caller's permission.
    const admin = createFirebaseAdminClient();
    const headerStore = await headers();
    const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
    const origin = host ? `${headerStore.get("x-forwarded-proto") ?? "https"}://${host}` : null;
    const normalizedEmail = values.email.trim().toLowerCase();
    let createdUser = false;
    let targetUser;
    try {
      targetUser = await admin.auth.getUserByEmail(normalizedEmail);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("user-not-found")) throw error;
      targetUser = await admin.auth.createUser({ email: normalizedEmail, emailVerified: false });
      createdUser = true;
    }
    await firebaseAdminFirestore()
      .collection("profiles")
      .doc(targetUser.uid)
      .set(
        {
          id: targetUser.uid,
          email: normalizedEmail,
          email_lower: normalizedEmail,
          full_name: targetUser.displayName ?? "",
          email_verified: targetUser.emailVerified,
          is_platform_admin: false,
          can_create_projects: false,
          created_at: FieldValue.serverTimestamp(),
          last_sign_in_at: null,
        },
        { merge: true },
      );
    const invite = await identityToolkitRequest("accounts:sendOobCode", {
      requestType: "PASSWORD_RESET",
      email: normalizedEmail,
      continueUrl: `${getSiteUrl(origin)}/auth/confirm?next=/reset-password`,
      canHandleCodeInApp: true,
    });
    if (invite.error) {
      if (createdUser) {
        await admin.auth.deleteUser(targetUser.uid).catch(() => undefined);
        await firebaseAdminFirestore()
          .collection("profiles")
          .doc(targetUser.uid)
          .delete()
          .catch(() => undefined);
      }
      if (["TOO_MANY_ATTEMPTS_TRY_LATER", "RESET_PASSWORD_EXCEED_LIMIT"].includes(invite.error.code))
        throw new AppError("RATE_LIMITED");
      console.error("[members] Firebase invitation email failed", invite.error.code);
      throw new AppError("INVITE_UNAVAILABLE");
    }
    unwrap(
      await firebase.rpc("add_project_member", { p_project_id: id, p_email: normalizedEmail, p_role: values.role }),
    );
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
    const { firebase, member } = await loadTarget(id, targetId);

    const target = { userId: member.user_id, role: member.role };
    const decision = values.role
      ? evaluateRoleChange(access, target, values.role)
      : evaluateMemberManage(access, target);
    if (!decision.ok) throw new AppError(decision.code);

    unwrap(
      await firebase.rpc("update_project_member", {
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
    const { firebase, member } = await loadTarget(id, targetId);

    const decision = evaluateMemberRemove(access, { userId: member.user_id, role: member.role });
    if (!decision.ok) throw new AppError(decision.code);

    unwrap(await firebase.rpc("remove_project_member", { p_project_id: id, p_user_id: targetId }));
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
    const { firebase, member } = await loadTarget(id, targetId);

    const currentRows = unwrap(
      await firebase.from("user_permissions").select("permission_key").eq("project_id", id).eq("user_id", targetId),
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
      await firebase.rpc("set_member_permissions", {
        p_project_id: id,
        p_user_id: targetId,
        p_permissions: permissions,
      }),
    );
    revalidateTeamPaths(id);
    return { permissions: (result ?? []).filter(isPermissionKey) };
  });
}
