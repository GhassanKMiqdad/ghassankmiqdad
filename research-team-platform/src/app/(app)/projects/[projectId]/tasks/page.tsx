import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Plus } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/pagination";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskTable } from "@/components/tasks/task-table";
import { Button } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";
import { can, canAssignTasks } from "@/lib/permissions/policy";
import { parseTaskSearchParams } from "@/lib/search-params";
import { getProjectAccess } from "@/server/access";
import { requireSessionUser } from "@/server/auth";
import { listAssignableMembers, listTasks } from "@/server/queries/tasks";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.tasks.title };
}

export default async function ProjectTasksPage(props: PageProps<"/projects/[projectId]/tasks">) {
  const { projectId } = await props.params;
  const user = await requireSessionUser();
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null; // denial rendered by the layout

  const filters = parseTaskSearchParams(await props.searchParams);
  const [{ t }, tasks, members] = await Promise.all([
    getI18n(),
    listTasks(user.id, { ...filters, projectId, teamId: filters.team }),
    can(access, "team.view") || canAssignTasks(access) ? listAssignableMembers(projectId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t.tasks.projectSubtitle}</p>
        {can(access, "tasks.create") ? (
          <Button asChild>
            <Link href={`/projects/${projectId}/tasks/new`}>
              <Plus aria-hidden />
              {t.tasks.new}
            </Link>
          </Button>
        ) : null}
      </div>
      <TaskFilters members={members.map((member) => ({ id: member.id, name: member.name }))} />
      {tasks.items.length === 0 ? (
        <EmptyState icon={ListChecks} title={t.tasks.empty} description={t.tasks.emptyHint} />
      ) : (
        <>
          <TaskTable tasks={tasks.items} />
          <Pagination page={tasks.page} pageSize={tasks.pageSize} total={tasks.total} />
        </>
      )}
    </div>
  );
}
