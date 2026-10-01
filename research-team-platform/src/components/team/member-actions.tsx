"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, MoreHorizontal, RotateCcw, ShieldCheck, UserMinus } from "lucide-react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import { evaluateMemberManage, evaluateMemberRemove } from "@/lib/permissions/policy";
import { removeMemberAction, updateMemberAction } from "@/server/actions/members";
import type { TeamMember } from "@/types/app";

export function MemberActions({
  projectId,
  member,
  access,
}: {
  projectId: string;
  member: TeamMember;
  access: ProjectAccessDTO;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const subject = fromAccessDTO(access);
  const target = { userId: member.userId, role: member.role };
  const canManage = evaluateMemberManage(subject, target).ok;
  const canRemove = evaluateMemberRemove(subject, target).ok;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t.common.actions} disabled={pending}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/projects/${projectId}/team/${member.userId}`}>
            <ShieldCheck aria-hidden />
            {t.team.manage}
          </Link>
        </DropdownMenuItem>
        {canManage ? (
          <DropdownMenuItem
            onSelect={() =>
              void run(
                () =>
                  updateMemberAction(projectId, member.userId, {
                    status: member.status === "active" ? "suspended" : "active",
                  }),
                { success: t.team.memberUpdated },
              )
            }
          >
            {member.status === "active" ? <Ban aria-hidden /> : <RotateCcw aria-hidden />}
            {member.status === "active" ? t.team.suspend : t.team.reactivate}
          </DropdownMenuItem>
        ) : null}
        {canRemove ? (
          <>
            <DropdownMenuSeparator />
            <ConfirmDialog
              trigger={
                <DropdownMenuItem variant="destructive" onSelect={(event) => event.preventDefault()}>
                  <UserMinus aria-hidden />
                  {t.team.remove}
                </DropdownMenuItem>
              }
              title={fmt(t.team.removeTitle, { name: member.displayName })}
              description={t.team.removeDescription}
              confirmLabel={t.common.remove}
              onConfirm={async () => {
                const result = await run(() => removeMemberAction(projectId, member.userId), {
                  success: t.team.memberRemoved,
                });
                if (result?.ok) router.refresh();
                return !!result?.ok;
              }}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
