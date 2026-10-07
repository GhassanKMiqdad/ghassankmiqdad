"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidField } from "@/lib/validation/common";
import { parseInput, runAction, unwrap } from "@/server/action";

/** RLS limits both updates to the caller's own notifications; only read_at is writable. */
export async function markNotificationReadAction(notificationId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, notificationId);
    const supabase = await createSupabaseServerClient();
    unwrap(await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).select("id"));
    revalidatePath("/", "layout");
    return null;
  });
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<null>> {
  return runAction(async (user) => {
    const supabase = await createSupabaseServerClient();
    unwrap(
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("read_at", null)
        .select("id"),
    );
    revalidatePath("/", "layout");
    return null;
  });
}
