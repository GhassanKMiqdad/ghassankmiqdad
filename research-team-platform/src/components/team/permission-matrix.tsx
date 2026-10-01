"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2, Lock } from "lucide-react";

import { useServerAction } from "@/components/shared/use-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_CATEGORY,
  PERMISSION_KEYS,
  ROLE_TEMPLATES,
  sortPermissionKeys,
  type PermissionKey,
  type ProjectRole,
} from "@/lib/permissions/catalog";
import { editablePermissionKeys, evaluatePermissionChange } from "@/lib/permissions/policy";
import { setMemberPermissionsAction } from "@/server/actions/members";
import type { TeamMember } from "@/types/app";

/**
 * Team → Member → Permissions. Every permission is a checkbox; the owner can
 * toggle everything, other managers only what they hold themselves. The server
 * action and the database re-validate the whole change and audit it.
 */
export function PermissionMatrix({
  projectId,
  member,
  access,
}: {
  projectId: string;
  member: TeamMember;
  access: ProjectAccessDTO;
}) {
  const { t, fmt } = useI18n();
  const { pending, run } = useServerAction();
  const actor = useMemo(() => fromAccessDTO(access), [access]);
  const [baseline, setBaseline] = useState<Set<PermissionKey>>(() => new Set(member.permissions));
  const [selected, setSelected] = useState<Set<PermissionKey>>(() => new Set(member.permissions));

  const isOwnerTarget = member.role === "owner";
  const decision = evaluatePermissionChange(actor, { userId: member.userId, role: member.role }, baseline, baseline);
  const canEdit = !isOwnerTarget && decision.ok;
  const editable = editablePermissionKeys(actor);

  const changes = PERMISSION_KEYS.filter((key) => baseline.has(key) !== selected.has(key)).length;

  const toggle = (key: PermissionKey, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  /** Applies a template only to the permissions the actor controls. */
  const applyKeys = (keys: readonly PermissionKey[]) => {
    const wanted = new Set(keys);
    setSelected((previous) => {
      const next = new Set(previous);
      for (const key of PERMISSION_KEYS) {
        if (!editable.has(key)) continue;
        if (wanted.has(key)) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const save = async () => {
    const result = await run(
      () => setMemberPermissionsAction(projectId, member.userId, { permissions: sortPermissionKeys(selected) }),
      { success: t.member.permissionsSaved },
    );
    if (result?.ok) {
      const saved = new Set(result.data.permissions);
      setBaseline(saved);
      setSelected(saved);
    }
  };

  const notice = isOwnerTarget
    ? t.member.ownerHasAll
    : decision.ok
      ? null
      : decision.code === "CANNOT_MODIFY_SELF"
        ? t.member.cannotEditOwn
        : decision.code === "INSUFFICIENT_RANK"
          ? t.member.cannotEditHigher
          : t.member.readOnlyPermissions;

  return (
    <div className="space-y-5">
      {notice ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {(["manager", "member", "reviewer"] as ProjectRole[]).map((role) => (
            <Button
              key={role}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyKeys(ROLE_TEMPLATES[role])}
            >
              {fmt(t.member.applyTemplate, { role: t.roles[role] })}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => applyKeys(PERMISSION_KEYS)}>
            {t.member.selectAll}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => applyKeys([])}>
            {t.member.clearAll}
          </Button>
        </div>
      ) : null}

      {canEdit && !selected.has("project.view") ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertDescription>{t.member.gateHint}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {PERMISSION_CATEGORIES.map((category) => {
          const keys = PERMISSION_KEYS.filter((key) => PERMISSION_CATEGORY[key] === category);
          return (
            <fieldset key={category} className="rounded-lg border p-4">
              <legend className="px-1 text-sm font-semibold">{t.permissions.categories[category]}</legend>
              <ul className="mt-1 space-y-3">
                {keys.map((key) => {
                  const item = t.permissions.items[key];
                  const checked = isOwnerTarget || selected.has(key);
                  const locked = !canEdit || !editable.has(key);
                  const changed = baseline.has(key) !== selected.has(key);
                  const id = `perm-${key}`;
                  return (
                    <li key={key} className="flex items-start gap-3">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={locked || pending}
                        onCheckedChange={(value) => toggle(key, value === true)}
                        className="mt-0.5"
                        aria-describedby={`${id}-description`}
                      />
                      <div className="min-w-0 flex-1">
                        <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium">
                          {item.label}
                          {changed ? <span className="size-1.5 rounded-full bg-primary" aria-hidden /> : null}
                          {canEdit && !editable.has(key) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Lock className="size-3.5 text-muted-foreground" aria-label={t.member.notHeldHint} />
                              </TooltipTrigger>
                              <TooltipContent>{t.member.notHeldHint}</TooltipContent>
                            </Tooltip>
                          ) : null}
                        </label>
                        <p id={`${id}-description`} className="text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>

      {canEdit ? (
        <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
          <span className="text-sm text-muted-foreground">
            {changes > 0 ? fmt(t.member.unsavedChanges, { count: changes }) : t.member.noChanges}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={changes === 0 || pending}
            onClick={() => setSelected(new Set(baseline))}
          >
            {t.common.cancel}
          </Button>
          <Button type="button" disabled={changes === 0 || pending} onClick={save}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t.member.savePermissions}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
