import "server-only";

import { can } from "@/lib/permissions/policy";
import { getMyProjectsAccess } from "@/server/access";
import { getProjectDetails } from "@/server/queries/projects";
import { listTasks } from "@/server/queries/tasks";

export type CalendarView = "day" | "week" | "month";
export type CalendarEvent = {
  id: string;
  projectId: string;
  title: string;
  date: string;
  kind: "project_start" | "project_deadline" | "task_deadline" | "milestone_deadline";
  href: string;
};

export function calendarRange(view: CalendarView, date: string): { from: string; to: string } {
  const anchor = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(anchor.getTime())) throw new Error("Invalid calendar date");
  let start: Date;
  let end: Date;
  if (view === "day") {
    start = anchor;
    end = anchor;
  } else if (view === "week") {
    start = new Date(anchor);
    const day = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - day);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
  } else {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  }
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function inRange(value: string | null, from: string, to: string): value is string {
  return typeof value === "string" && value >= from && value <= to;
}

/**
 * Each project is obtained from the signed-in user's project memberships. Task
 * queries are then constrained to an assigned-only view unless the caller has
 * tasks.view in that project; unrelated projects/tasks never enter the result.
 */
export async function listAuthorizedCalendarEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const accessList = (await getMyProjectsAccess()).filter((access) => can(access, "project.view"));
  const results = await Promise.all(
    accessList.map(async (access) => {
      const project = await getProjectDetails(access.projectId);
      if (!project) return [] as CalendarEvent[];
      const events: CalendarEvent[] = [];
      if (inRange(project.startDate, from, to)) {
        events.push({
          id: `${project.id}:start`,
          projectId: project.id,
          title: `${project.name} — starts`,
          date: project.startDate,
          kind: "project_start",
          href: `/projects/${project.id}`,
        });
      }
      if (inRange(project.deadline, from, to)) {
        events.push({
          id: `${project.id}:deadline`,
          projectId: project.id,
          title: `${project.name} — deadline`,
          date: project.deadline,
          kind: "project_deadline",
          href: `/projects/${project.id}`,
        });
      }
      const tasks = await listTasks(access.userId, {
        projectId: access.projectId,
        assignee: can(access, "tasks.view") ? undefined : "me",
        page: 1,
        pageSize: 100,
      });
      for (const task of tasks.items) {
        if (!inRange(task.dueDate, from, to)) continue;
        events.push({
          id: `${task.projectId}:${task.id}:deadline`,
          projectId: task.projectId,
          title: `${task.title} — ${project.name}`,
          date: task.dueDate,
          kind: "task_deadline",
          href: `/projects/${task.projectId}/tasks/${task.id}`,
        });
      }
      return events;
    }),
  );
  return results.flat().sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
