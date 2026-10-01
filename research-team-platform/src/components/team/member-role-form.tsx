"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import type { ProjectRole } from "@/lib/permissions/catalog";
import { assignableRoles, evaluateMemberManage } from "@/lib/permissions/policy";
import { updateMemberAction } from "@/server/actions/members";
import type { TeamMember } from "@/types/app";

export function MemberRoleForm({
  projectId,
  member,
  access,
}: {
  projectId: string;
  member: TeamMember;
  access: ProjectAccessDTO;
}) {
  const { t } = useI18n();
  const { pending, run } = useServerAction();
  const actor = fromAccessDTO(access);
  const canManage = evaluateMemberManage(actor, { userId: member.userId, role: member.role }).ok;
  const roles = assignableRoles(actor);
  const [role, setRole] = useState<ProjectRole>(member.role);
  const [resetPermissions, setResetPermissions] = useState(true);

  if (!canManage) {
    return null;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="member-role">{t.team.role}</Label>
        <Select value={role} onValueChange={(value) => setRole(value as ProjectRole)}>
          <SelectTrigger id="member-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from(new Set([member.role, ...roles])).map((option) => (
              <SelectItem key={option} value={option} disabled={!roles.includes(option)}>
                {t.roles[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t.roleDescriptions[role]}</p>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="reset-permissions"
          checked={resetPermissions}
          onCheckedChange={(value) => setResetPermissions(value === true)}
          className="mt-0.5"
        />
        <Label htmlFor="reset-permissions" className="leading-snug font-normal">
          {t.member.resetPermissions}
        </Label>
      </div>
      <Button
        type="button"
        disabled={pending || role === member.role}
        onClick={() =>
          void run(
            () =>
              updateMemberAction(projectId, member.userId, {
                role: role as "manager" | "member" | "reviewer",
                resetPermissions,
              }),
            { success: t.team.memberUpdated },
          )
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {t.member.saveRole}
      </Button>

      <div className="flex items-center justify-between gap-4 border-t pt-5">
        <div>
          <p className="text-sm font-medium">{member.status === "active" ? t.team.suspend : t.team.reactivate}</p>
          <p className="text-xs text-muted-foreground">{t.memberStatus[member.status]}</p>
        </div>
        <Switch
          checked={member.status === "active"}
          disabled={pending}
          aria-label={member.status === "active" ? t.team.suspend : t.team.reactivate}
          onCheckedChange={(checked) =>
            void run(() => updateMemberAction(projectId, member.userId, { status: checked ? "active" : "suspended" }), {
              success: t.team.memberUpdated,
            })
          }
        />
      </div>
    </div>
  );
}
