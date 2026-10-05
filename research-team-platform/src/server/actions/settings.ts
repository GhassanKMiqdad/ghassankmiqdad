"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { firebaseAdminAuth } from "@/lib/firebase/admin";
import { identityToolkitRequest } from "@/lib/firebase/auth-rest";
import { FIREBASE_SESSION_COOKIE } from "@/lib/firebase/server";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { passwordChangeSchema } from "@/lib/validation/auth";
import { platformFlagsSchema, profileSchema } from "@/lib/validation/settings";
import { getCurrentProfile } from "@/server/auth";
import { parseInput, runAction, unwrap } from "@/server/action";

export async function updateProfileAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const { fullName } = parseInput(profileSchema, input);
    const firebase = await createFirebaseServerClient();
    const updated = unwrap(
      await firebase.from("profiles").update({ full_name: fullName }).eq("id", user.id).select("id"),
    );
    if (updated.length === 0) throw new AppError("PERMISSION_DENIED");
    revalidatePath("/", "layout");
    return null;
  });
}

export async function changePasswordAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const { currentPassword, password } = parseInput(passwordChangeSchema, input);
    if (!user.email) throw new AppError("REAUTHENTICATION_REQUIRED");
    const verification = await identityToolkitRequest<{ localId?: string }>("accounts:signInWithPassword", {
      email: user.email,
      password: currentPassword,
      returnSecureToken: true,
    });
    if (verification.error || verification.data.localId !== user.id) throw new AppError("REAUTHENTICATION_REQUIRED");
    await firebaseAdminAuth().updateUser(user.id, { password });
    try {
      await firebaseAdminAuth().revokeRefreshTokens(user.id);
    } finally {
      (await cookies()).delete(FIREBASE_SESSION_COOKIE);
    }
    return null;
  });
}

export async function updatePlatformFlagsAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const values = parseInput(platformFlagsSchema, input);
    const profile = await getCurrentProfile();
    if (!profile?.isPlatformAdmin) throw new AppError("PERMISSION_DENIED");

    const firebase = await createFirebaseServerClient();
    unwrap(
      await firebase.rpc("admin_update_user_flags", {
        p_user_id: values.userId,
        p_is_platform_admin: values.isPlatformAdmin,
        p_can_create_projects: values.canCreateProjects,
      }),
    );
    revalidatePath("/settings");
    return null;
  });
}
