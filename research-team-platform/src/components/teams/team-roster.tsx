"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, MoreHorizontal, Pencil, Power, Trash2, UserPlus, X } from "lucide-react";

import { OrgRoleBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useServerAction } from "@/components/shared/use-action";
import { LinkAccountDialog, TeamMemberDialog } from "@/components/teams/team-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/provider";
import {
  removeTeamMemberAction,
  setDirectorAction,
  setProjectTeamAction,
  setTeamMemberStatusAction,
} from "@/server/actions/teams";
import type { TeamRosterMember } from "@/types/app";

const STATUS_VARIANT = { pending: "warning", active: "success", inactive: "muted" } as const;

export function TeamRoster({
  teamId,
  roster,
  editable,
}: {
  teamId: string;
  roster: TeamRosterMember[];
  editable: boolean;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();

  return (
    <div className="space-y-3">
      {editable ? (
        <div className="flex justify-end">
          <TeamMemberDialog
            teamId={teamId}
            trigger={
              <Button size="sm">
                <UserPlus aria-hidden />
                {t.teams.addMember}
              </Button>
            }
          />
        </div>
      ) : null}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="ps-3">{t.teams.memberCode}</TableHead>
              <TableHead>{t.teams.displayName}</TableHead>
              <TableHead>{t.teams.jobTitle}</TableHead>
              <TableHead>{t.teams.teamRole}</TableHead>
              <TableHead>{t.common.status}</TableHead>
              {editable ? <TableHead>{t.teams.account}</TableHead> : null}
              {editable ? (
                <TableHead className="w-10 pe-3">
                  <span className="sr-only">{t.common.actions}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {roster.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="ps-3">
                  <span dir="ltr" className="font-mono text-xs font-semibold">
                    {member.memberCode}
                  </span>
                </TableCell>
                <TableCell className="font-medium">{member.displayName}</TableCell>
                <TableCell className="text-muted-foreground">{member.jobTitle || "—"}</TableCell>
                <TableCell>
                  <OrgRoleBadge role={member.role} />
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[member.status]}>{t.teams.status[member.status]}</Badge>
                </TableCell>
                {editable ? (
                  <TableCell className="max-w-48 truncate text-xs text-muted-foreground" dir="ltr">
                    {member.accountEmail ?? member.inviteEmail ?? t.teams.noAccount}
                  </TableCell>
                ) : null}
                {editable ? (
                  <TableCell className="pe-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={t.common.actions} disabled={pending}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <TeamMemberDialog
                          teamId={teamId}
                          member={member}
                          trigger={
                            <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                              <Pencil aria-hidden />
                              {t.teams.editMember}
                            </DropdownMenuItem>
                          }
                        />
                        {!member.userId ? (
                          <LinkAccountDialog
                            member={member}
                            trigger={
                              <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                                <Link2 aria-hidden />
                                {t.teams.linkAccount}
                              </DropdownMenuItem>
                            }
                          />
                        ) : (
                          <DropdownMenuItem
                            onSelect={async () => {
                              const result = await run(
                                () =>
                                  setTeamMemberStatusAction(member.id, {
                                    status: member.status === "active" ? "inactive" : "active",
                                  }),
                                { success: t.teams.statusChanged },
                              );
                              if (result?.ok) router.refresh();
                            }}
                          >
                            <Power aria-hidden />
                            {member.status === "active" ? t.teams.deactivate : t.teams.activate}
                          </DropdownMenuItem>
                        )}
                        <ConfirmDialog
                          trigger={
                            <DropdownMenuItem variant="destructive" onSelect={(event) => event.preventDefault()}>
                              <Trash2 aria-hidden />
                              {t.common.remove}
                            </DropdownMenuItem>
                          }
                          title={fmt(t.teams.removeTitle, { name: member.displayName })}
                          description={t.teams.removeDescription}
                          confirmLabel={t.common.remove}
                          onConfirm={async () => {
                            const result = await run(() => removeTeamMemberAction(member.id), {
                              success: t.teams.memberRemoved,
                            });
                            if (result?.ok) router.refresh();
                            return !!result?.ok;
                          }}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function TeamProjects({
  teamId,
  linked,
  candidates,
  editable,
}: {
  teamId: string;
  linked: { id: string; name: string }[];
  candidates: { id: string; name: string }[];
  editable: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [choice, setChoice] = useState("");

  return (
    <div className="space-y-2">
      {linked.length === 0 ? <p className="text-sm text-muted-foreground">{t.teams.noProjects}</p> : null}
      <ul className="flex flex-wrap gap-2">
        {linked.map((project) => (
          <li key={project.id} className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm">
            <a href={`/projects/${project.id}`} className="hover:underline">
              {project.name}
            </a>
            {editable ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6"
                aria-label={t.teams.unlinkProject}
                disabled={pending}
                onClick={async () => {
                  const result = await run(() => setProjectTeamAction(project.id, null), {
                    success: t.teams.projectUnlinked,
                  });
                  if (result?.ok) router.refresh();
                }}
              >
                <X aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {editable && candidates.length > 0 ? (
        <div className="flex gap-2">
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className="w-64" aria-label={t.teams.chooseProject}>
              <SelectValue placeholder={t.teams.chooseProject} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!choice || pending}
            onClick={async () => {
              const result = await run(() => setProjectTeamAction(choice, teamId), { success: t.teams.projectLinked });
              if (result?.ok) {
                setChoice("");
                router.refresh();
              }
            }}
          >
            <Link2 aria-hidden />
            {t.teams.linkProject}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function DirectorSwitch({ userId, isDirector, self }: { userId: string; isDirector: boolean; self: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  return (
    <Switch
      checked={isDirector}
      disabled={pending || (self && isDirector)}
      aria-label={t.teams.makeDirector}
      onCheckedChange={async (checked) => {
        const result = await run(() => setDirectorAction(userId, checked), { success: t.teams.directorUpdated });
        if (result?.ok) router.refresh();
      }}
    />
  );
}
