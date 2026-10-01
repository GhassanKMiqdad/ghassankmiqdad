import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Plus } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskTable } from "@/components/tasks/task-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import { can } from "@/lib/permissions/policy";
import { parseTaskSearchParams } from "@/lib/search-params";
import { getMyProjectsAccess } from "@/server/access";
import { requireSessionUser } from "@/server/auth";
import { listTasks } from "@/server/queries/tasks";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.tasks.title };
}

export default async function AllTasksPage(props: PageProps<"/tasks">) {
  const user = await requireSessionUser();
  const filters = parseTaskSearchParams(await props.searchParams);
  const [{ t }, access] = await Promise.all([getI18n(), getMyProjectsAccess()]);
  const projects = access.filter((item) => can(item, "project.view"));
  const creatable = projects.filter((item) => can(item, "tasks.create"));

  const tasks = await listTasks(user.id, { ...filters, projectId: filters.project });
  const accessByProject = Object.fromEntries(projects.map((item) => [item.projectId, toAccessDTO(item)]));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.tasks.title}
        description={t.tasks.subtitle}
        actions={
          creatable.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Plus aria-hidden />
                  {t.tasks.new}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-72">
                {creatable.map((item) => (
                  <DropdownMenuItem key={item.projectId} asChild>
                    <Link href={`/projects/${item.projectId}/tasks?new=1`} className="truncate">
                      {item.projectName}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
      <TaskFilters projects={projects.map((item) => ({ id: item.projectId, name: item.projectName }))} />
      {tasks.items.length === 0 ? (
        <EmptyState icon={ListChecks} title={t.tasks.empty} description={t.tasks.emptyHint} />
      ) : (
        <>
          <TaskTable tasks={tasks.items} accessByProject={accessByProject} showProject />
          <Pagination page={tasks.page} pageSize={tasks.pageSize} total={tasks.total} />
        </>
      )}
    </div>
  );
}
