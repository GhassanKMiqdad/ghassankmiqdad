"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { firebaseAdminStorage } from "@/lib/firebase/admin";
import { createFirebaseServerClient } from "@/lib/firebase/compat";
import { uuidField } from "@/lib/validation/common";
import { deleteProjectSchema, projectFormSchema, transferOwnershipSchema } from "@/lib/validation/project";
import { getCurrentProfile } from "@/server/auth";
import { assertProjectAccess, assertProjectPermission } from "@/server/access";
import { parseInput, runAction, unwrap } from "@/server/action";

export async function createProjectAction(input: unknown): Promise<ActionResult<{ projectId: string }>> {
  return runAction(async () => {
    const values = parseInput(projectFormSchema, input);
    const profile = await getCurrentProfile();
    if (!profile?.canCreateProjects) throw new AppError("PROJECT_CREATE_FORBIDDEN");

    const firebase = await createFirebaseServerClient();
    const projectId = unwrap(
      await firebase.rpc("create_project", {
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

    const firebase = await createFirebaseServerClient();
    const updated = unwrap(
      await firebase
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

    const firebase = await createFirebaseServerClient();
    const deleted = unwrap(await firebase.from("projects").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new AppError("PERMISSION_DENIED");

    // The rows are gone (and audited); remove the stored files as well.
    await removeProjectFiles(id);

    revalidatePath("/", "layout");
    return null;
  });
}

/**
 * Deletes every object under "<projectId>/" after the caller's project.delete
 * permission has been independently checked by the server action and adapter.
 */
async function removeProjectFiles(projectId: string) {
  const bucket = firebaseAdminStorage();
  const [files] = await bucket.getFiles({ prefix: `${projectId}/` });
  for (let index = 0; index < files.length; index += 100) {
    await Promise.all(files.slice(index, index + 100).map((file) => file.delete({ ignoreNotFound: true })));
  }
}

export async function transferOwnershipAction(projectId: string, input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const id = parseInput(uuidField, projectId);
    const { newOwnerId } = parseInput(transferOwnershipSchema, input);
    const access = await assertProjectAccess(id);
    if (!access.isOwner) throw new AppError("PERMISSION_DENIED");

    const firebase = await createFirebaseServerClient();
    unwrap(await firebase.rpc("transfer_project_ownership", { p_project_id: id, p_new_owner_id: newOwnerId }));

    revalidatePath("/", "layout");
    return null;
  });
}
