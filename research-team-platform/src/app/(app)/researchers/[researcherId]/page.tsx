import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BriefcaseBusiness, ClipboardList, UsersRound } from "lucide-react";
import { z } from "zod";

import { ResearcherProfileForm } from "@/components/research/researcher-profile-form";
import { TaskStatusBadge } from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { TASK_STATUSES, type TaskStatus } from "@/lib/permissions/catalog";
import { getCurrentProfile } from "@/server/auth";
import { getResearcherTaskWorkload, listResearcherProfiles } from "@/server/queries/research";

function taskStatus(value: unknown): TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : "todo";
}

export default async function ResearcherDetailsPage(props: PageProps<"/researchers/[researcherId]">) {
  const { researcherId } = await props.params;
  if (!z.uuid().safeParse(researcherId).success) notFound();
  const [profile, i18n] = await Promise.all([getCurrentProfile(), getI18n()]);
  if (!profile?.isPlatformAdmin) notFound();
  const { t } = i18n;
  const [researchers, tasks] = await Promise.all([listResearcherProfiles(), getResearcherTaskWorkload(researcherId)]);
  const researcher = researchers.find((item) => item.id === researcherId);
  if (!researcher) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/researchers"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t.researchers.title}
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">{researcher.fullName || researcher.email}</h1>
        <p className="mt-1 text-sm text-muted-foreground" dir="ltr">
          {researcher.email}
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardList className="size-4" aria-hidden />
              {t.researchers.workload}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{researcher.activeTaskCount}</p>
            <p className="text-xs text-muted-foreground">
              {t.researchers.overdueTasks}: {researcher.overdueTaskCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <BriefcaseBusiness className="size-4" aria-hidden />
              {t.researchers.projects}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{researcher.assignedProjects.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <UsersRound className="size-4" aria-hidden />
              {t.researchers.teams}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{researcher.assignedTeams.length}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t.researchers.edit}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResearcherProfileForm researcher={researcher} />
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.researchers.projects}</CardTitle>
          </CardHeader>
          <CardContent>
            {researcher.assignedProjects.length ? (
              <ul className="space-y-2">
                {researcher.assignedProjects.map((project) => (
                  <li key={project.id}>
                    <Link className="text-sm font-medium text-primary hover:underline" href={`/projects/${project.id}`}>
                      {project.name || project.id}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t.common.none}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t.researchers.teams}</CardTitle>
          </CardHeader>
          <CardContent>
            {researcher.assignedTeams.length ? (
              <ul className="space-y-2">
                {researcher.assignedTeams.map((team) => (
                  <li key={team.id}>
                    <Link
                      className="text-sm font-medium text-primary hover:underline"
                      href={`/projects/${team.projectId}/teams/${team.id}`}
                    >
                      {team.name || team.id}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t.common.none}</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t.researchers.assignedTasks}</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length ? (
            <ul className="divide-y rounded-lg border">
              {tasks.map((task) => (
                <li key={task.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/projects/${task.projectId}/tasks/${task.id}`} className="font-medium hover:underline">
                      {task.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {task.projectName} · {t.tasks.fields.dueDate}:{" "}
                      <DateText value={task.dueDate} fallback={t.tasks.noDueDate} />
                    </p>
                  </div>
                  <TaskStatusBadge status={taskStatus(task.status)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t.researchers.noAssignedTasks}</p>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        {t.researchers.createdAt}: <DateText value={researcher.createdAt} /> · {t.researchers.lastActivity}:{" "}
        <DateText value={researcher.lastSignInAt} fallback={t.common.notSet} />
      </p>
    </div>
  );
}
