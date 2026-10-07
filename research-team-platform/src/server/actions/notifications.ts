"use server";

import type { ActionResult } from "@/lib/action-result";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { uuidField } from "@/lib/validation/common";
import { parseInput, runAction } from "@/server/action";

export async function markNotificationReadAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, input);
    const firebase = await createFirebaseServerClient();
    const { error } = await firebase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return null;
  });
}
