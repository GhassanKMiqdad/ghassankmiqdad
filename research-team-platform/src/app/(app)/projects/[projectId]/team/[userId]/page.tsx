import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";

import { ActivityList } from "@/components/activity/activity-list";
import { AccessDenied } from "@/components/shared/access-denied";
import { MemberStatusBadge, RoleBadge, TaskStatusBadge } from "@/components/shared/badges";
import { DateText } from "@/components/shared/date-text";
import { UserAvatar } from "@/components/shared/user-avatar";
import { MemberRoleForm } from "@/components/team/member-role-form";
import { PermissionMatrix } from "@/components/team/permission-matrix";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import { can, evaluateMemberManage } from "@/lib/permissions/policy";
import { getProjectAccess } from "@/server/access";
import { requireSessionUser } from "@/server/auth";
import { listActivity } from "@/server/queries/activity";
import { listTasks } from "@/server/queries/tasks";
import { getTeamMember } from "@/server/queries/team";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.member.permissionsTitle };
}

export default async function MemberPage(props: PageProps<"/projects/[projectId]/team/[userId]">) {
  const { projectId, userId } = await props.params;
  if (!z.uuid().safeParse(userId).success) notFound();

  const user = await requireSessionUser();
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null;

  const i18n = await getI18n();
  const { t, fmt } = i18n;
  if (!can(access, "team.view")) return <AccessDenied />;

  const member = await getTeamMember(projectId, userId);
  if (!member) return <AccessDenied message={t.errors.MEMBER_NOT_FOUND} />;

  const [tasks, activity] = await Promise.all([
    listTasks(user.id, { projectId, assignee: userId, pageSize: 10 }),
    can(access, "activity.view") ? listActivity({ projectId, actorId: userId, pageSize: 15 }) : Promise.resolve(null),
  ]);
  const dto = toAccessDTO(access);
  const canManage = evaluateMemberManage(access, { userId: member.userId, role: member.role }).ok;

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}/team`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t.member.backToTeam}
      </Link>

      <Card className="flex-row items-center gap-4 px-6">
        <UserAvatar name={member.displayName} seed={member.userId} className="size-14 text-base" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="truncate text-lg font-semibold">{member.displayName}</h2>
          <p className="truncate text-sm text-muted-foreground">
            <span dir="ltr">{member.email}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <RoleBadge role={member.role} />
            <MemberStatusBadge status={member.status} pending={!member.lastSignInAt} />
            <span className="text-xs text-muted-foreground">
              {fmt(t.member.joined, { date: i18n.date(member.joinedAt) })}
            </span>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.member.permissionsTitle}</CardTitle>
              <CardDescription>
                {fmt(
                  can(access, "permissions.manage") && member.role !== "owner"
                    ? t.member.permissionsDescription
                    : t.member.permissionsDescriptionReadOnly,
                  { name: member.displayName },
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PermissionMatrix projectId={projectId} member={member} access={dto} />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>{t.member.roleAndStatus}</CardTitle>
                <CardDescription>{t.member.roleAndStatusDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                <MemberRoleForm projectId={projectId} member={member} access={dto} />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{t.member.tasksTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {tasks.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.dashboard.noTasks}</p>
              ) : (
                <ul className="space-y-3">
                  {tasks.items.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-2">
                      <Link
                        href={`/projects/${projectId}/tasks/${task.id}`}
                        className="min-w-0 truncate text-sm hover:underline"
                      >
                        {task.title}
                      </Link>
                      <div className="flex shrink-0 items-center gap-2">
                        <DateText value={task.dueAt} style="datetime" fallback="" className="text-xs text-muted-foreground" />
                        <TaskStatusBadge status={task.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {activity ? (
            <Card>
              <CardHeader>
                <CardTitle>{t.member.activityTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityList items={activity.items} compact />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
