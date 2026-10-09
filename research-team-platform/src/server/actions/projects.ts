"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { getServiceRoleKey } from "@/lib/env.server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidField } from "@/lib/validation/common";
import { deleteProjectSchema, projectFormSchema, transferOwnershipSchema } from "@/lib/validation/project";
import { getCurrentProfile } from "@/server/auth";
import { assertProjectAccess, assertProjectPermission } from "@/server/access";
import { parseInput, runAction, unwrap } from "@/server/action";
import { DOCUMENT_BUCKET } from "@/server/storage";

export async function createProjectAction(input: unknown): Promise<ActionResult<{ projectId: string }>> {
  return runAction(async () => {
    const values = parseInput(projectFormSchema, input);
    const profile = await getCurrentProfile();
    if (!profile?.canCreateProjects) throw new AppError("PROJECT_CREATE_FORBIDDEN");

    const supabase = await createSupabaseServerClient();
    const projectId = unwrap(
      await supabase.rpc("create_project", {
        p_name: values.name,
        p_description: values.description,
        p_research_goal: values.researchGoal,
        p_status: values.status,
        p_start_date: values.startDate ?? undefined,
        p_deadline: values.deadline ?? undefined,
      }),
    );

    revalidatePath("/", "layout");
    return { projectId };
  });
}

export async function updateProjectAction(projectId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const values = parseInput(projectFormSchema, input);
    await assertProjectPermission(id, "project.edit");

    const supabase = await createSupabaseServerClient();
    const updated = unwrap(
      await supabase
        .from("projects")
        .update({
          name: values.name,
          description: values.description,
          research_goal: values.researchGoal,
          status: values.status,
          start_date: values.startDate,
          deadline: values.deadline,
        })
        .eq("id", id)
        .select("id"),
    );
    if (updated.length === 0) throw new AppError("PERMISSION_DENIED");

    revalidatePath("/", "layout");
    return null;
  });
}

export async function deleteProjectAction(projectId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const { confirmation } = parseInput(deleteProjectSchema, input);
    const access = await assertProjectPermission(id, "project.delete");
    if (confirmation.trim() !== access.projectName.trim()) throw new AppError("CONFIRMATION_MISMATCH");
    if (!getServiceRoleKey()) throw new AppError("ADMIN_UNAVAILABLE");

    const supabase = await createSupabaseServerClient();
    const deleted = unwrap(await supabase.from("projects").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new AppError("PERMISSION_DENIED");

    // The rows are gone (and audited); remove the stored files as well.
    await removeProjectFiles(id);

    revalidatePath("/", "layout");
    return null;
  });
}

/**
 * Deletes every object under "<projectId>/". Runs with the service role only
 * after the caller deleted the project with their own (RLS-checked) session.
 */
async function removeProjectFiles(projectId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    console.warn(`[projects] SUPABASE_SERVICE_ROLE_KEY missing: files of project ${projectId} were not removed.`);
    return;
  }
  const bucket = admin.storage.from(DOCUMENT_BUCKET);
  const { data: folders, error } = await bucket.list(projectId, { limit: 1000 });
  if (error) {
    console.error("[projects] could not list project files", error.message);
    return;
  }
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files } = await bucket.list(`${projectId}/${folder.name}`, { limit: 100 });
    for (const file of files ?? []) paths.push(`${projectId}/${folder.name}/${file.name}`);
  }
  for (let index = 0; index < paths.length; index += 100) {
    const { error: removeError } = await bucket.remove(paths.slice(index, index + 100));
    if (removeError) console.error("[projects] could not remove project files", removeError.message);
  }
}

export async function transferOwnershipAction(projectId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const { newOwnerId } = parseInput(transferOwnershipSchema, input);
    const access = await assertProjectAccess(id);
    if (!access.isOwner) throw new AppError("PERMISSION_DENIED");

    const supabase = await createSupabaseServerClient();
    unwrap(await supabase.rpc("transfer_project_ownership", { p_project_id: id, p_new_owner_id: newOwnerId }));

    revalidatePath("/", "layout");
    return null;
  });
}
