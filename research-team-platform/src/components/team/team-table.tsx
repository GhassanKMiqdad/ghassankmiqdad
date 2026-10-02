"use client";

import Link from "next/link";

import { MemberStatusBadge, RoleBadge } from "@/components/shared/badges";
import { DateText, RelativeTime } from "@/components/shared/date-text";
import { UserAvatar } from "@/components/shared/user-avatar";
import { MemberActions } from "@/components/team/member-actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/provider";
import type { ProjectAccessDTO } from "@/lib/permissions/access";
import { PERMISSION_KEYS } from "@/lib/permissions/catalog";
import type { TeamMember } from "@/types/app";

export function TeamTable({
  projectId,
  members,
  access,
}: {
  projectId: string;
  members: TeamMember[];
  access: ProjectAccessDTO;
}) {
  const { t, fmt } = useI18n();

  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-4">{t.team.columns.member}</TableHead>
            <TableHead>{t.team.columns.role}</TableHead>
            <TableHead>{t.team.columns.status}</TableHead>
            <TableHead>{t.team.columns.assignedTasks}</TableHead>
            <TableHead>{t.team.columns.permissions}</TableHead>
            <TableHead>{t.team.columns.lastActivity}</TableHead>
            <TableHead className="w-12 pe-4">
              <span className="sr-only">{t.common.actions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.userId}>
              <TableCell className="ps-4">
                <Link href={`/projects/${projectId}/team/${member.userId}`} className="flex items-center gap-3">
                  <UserAvatar name={member.displayName} seed={member.userId} />
                  <span className="min-w-0">
                    <span className="block max-w-56 truncate font-medium hover:underline">
                      {member.displayName}
                      {member.userId === access.userId ? (
                        <span className="ms-1 text-xs font-normal text-muted-foreground">{t.team.you}</span>
                      ) : null}
                    </span>
                    <span className="block max-w-56 truncate text-xs text-muted-foreground">
                      <span dir="ltr">{member.email}</span>
                    </span>
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                <RoleBadge role={member.role} />
              </TableCell>
              <TableCell>
                <MemberStatusBadge status={member.status} pending={!member.lastSignInAt} />
              </TableCell>
              <TableCell className="tabular-nums">
                {fmt(t.team.openTasks, { open: member.assignedOpenTasks, total: member.assignedTotalTasks })}
              </TableCell>
              <TableCell className="tabular-nums">
                {fmt(t.team.permissionsCount, { count: member.permissions.length, total: PERMISSION_KEYS.length })}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {member.lastActivityAt ? (
                  <RelativeTime value={member.lastActivityAt} />
                ) : member.lastSignInAt ? (
                  <DateText value={member.lastSignInAt} />
                ) : (
                  t.team.noActivity
                )}
              </TableCell>
              <TableCell className="pe-4">
                <MemberActions projectId={projectId} member={member} access={access} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
