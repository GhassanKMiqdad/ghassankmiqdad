"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { newPasswordSchema } from "@/lib/validation/auth";
import { platformFlagsSchema, profileSchema } from "@/lib/validation/settings";
import { getCurrentProfile } from "@/server/auth";
import { parseInput, runAction, unwrap } from "@/server/action";

export async function updateProfileAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const { fullName } = parseInput(profileSchema, input);
    const supabase = await createSupabaseServerClient();
    const updated = unwrap(
      await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id).select("id"),
    );
    if (updated.length === 0) throw new AppError("PERMISSION_DENIED");
    revalidatePath("/", "layout");
    return null;
  });
}

export async function changePasswordAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { password } = parseInput(newPasswordSchema, input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.code === "same_password" || error.code === "weak_password") throw new AppError("INVALID_INPUT");
      throw error;
    }
    return null;
  });
}

export async function updatePlatformFlagsAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const values = parseInput(platformFlagsSchema, input);
    const profile = await getCurrentProfile();
    if (!profile?.isPlatformAdmin) throw new AppError("PERMISSION_DENIED");

    const supabase = await createSupabaseServerClient();
    unwrap(
      await supabase.rpc("admin_update_user_flags", {
        p_user_id: values.userId,
        p_is_platform_admin: values.isPlatformAdmin,
        p_can_create_projects: values.canCreateProjects,
      }),
    );
    revalidatePath("/settings");
    return null;
  });
}
