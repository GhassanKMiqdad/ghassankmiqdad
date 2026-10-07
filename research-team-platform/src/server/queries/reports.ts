import "server-only";

import { can } from "@/lib/permissions/policy";
import { getMyProjectsAccess } from "@/server/access";
import { getDashboardStats } from "@/server/queries/dashboard";
import { listTasks } from "@/server/queries/tasks";
import type { TaskListItem } from "@/types/app";

export type AuthorizedReportRow = {
  projectId: string;
  projectName: string;
  task: TaskListItem;
};

const PAGE_SIZE = 100;
const MAX_PAGES_PER_PROJECT = 20;

export async function getAuthorizedReportData() {
  const access = (await getMyProjectsAccess()).filter((item) => can(item, "project.view"));
  const [stats, projectResults] = await Promise.all([
    getDashboardStats(),
    Promise.all(
      access.map(async (project) => {
        const items: TaskListItem[] = [];
        let total = 0;
        let page = 1;
        do {
          const result = await listTasks(project.userId, {
            projectId: project.projectId,
            assignee: can(project, "tasks.view") ? undefined : "me",
            page,
            pageSize: PAGE_SIZE,
          });
          items.push(...result.items);
          total = result.total;
          page += 1;
        } while (items.length < total && page <= MAX_PAGES_PER_PROJECT);
        return {
          rows: items.map((task) => ({ projectId: project.projectId, projectName: project.projectName, task })),
          truncated: items.length < total,
        };
      }),
    ),
  ]);
  return {
    stats,
    projects: access.map((item) => ({
      id: item.projectId,
      name: item.projectName,
      status: item.projectStatus,
      role: item.role,
      canViewTeam: can(item, "team.view"),
      canViewAllTasks: can(item, "tasks.view"),
    })),
    rows: projectResults.flatMap((result) => result.rows) as AuthorizedReportRow[],
    truncated: projectResults.some((result) => result.truncated),
  };
}
