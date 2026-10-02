"use client";

import { DateText } from "@/components/shared/date-text";
import { useServerAction } from "@/components/shared/use-action";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/provider";
import { updatePlatformFlagsAction } from "@/server/actions/settings";
import type { PlatformUser } from "@/types/app";

export function AdminUsersTable({ users, currentUserId }: { users: PlatformUser[]; currentUserId: string }) {
  const { t } = useI18n();
  const { pending, run } = useServerAction();

  const update = (userId: string, patch: { isPlatformAdmin?: boolean; canCreateProjects?: boolean }) =>
    void run(() => updatePlatformFlagsAction({ userId, ...patch }), { success: t.settings.admin.updated });

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-4">{t.common.name}</TableHead>
            <TableHead>{t.settings.admin.joined}</TableHead>
            <TableHead>{t.settings.admin.lastSignIn}</TableHead>
            <TableHead className="text-center">{t.settings.admin.canCreateProjects}</TableHead>
            <TableHead className="pe-4 text-center">{t.settings.admin.platformAdmin}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const name = user.fullName.trim() || user.email || "—";
            const self = user.id === currentUserId;
            return (
              <TableRow key={user.id}>
                <TableCell className="ps-4">
                  <div className="flex items-center gap-3">
                    <UserAvatar name={name} seed={user.id} />
                    <div className="min-w-0">
                      <p className="max-w-56 truncate font-medium">
                        {name}
                        {self ? (
                          <span className="ms-1 text-xs font-normal text-muted-foreground">{t.team.you}</span>
                        ) : null}
                      </p>
                      <p className="max-w-56 truncate text-xs text-muted-foreground">
                        <span dir="ltr">{user.email}</span>
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <DateText value={user.createdAt} />
                </TableCell>
                <TableCell>
                  <DateText value={user.lastSignInAt} fallback="—" />
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={user.isPlatformAdmin || user.canCreateProjects}
                    disabled={pending || user.isPlatformAdmin}
                    aria-label={`${t.settings.admin.canCreateProjects}: ${name}`}
                    onCheckedChange={(checked) => update(user.id, { canCreateProjects: checked })}
                  />
                </TableCell>
                <TableCell className="pe-4 text-center">
                  <Switch
                    checked={user.isPlatformAdmin}
                    disabled={pending || self}
                    title={self ? t.settings.admin.selfHint : undefined}
                    aria-label={`${t.settings.admin.platformAdmin}: ${name}`}
                    onCheckedChange={(checked) => update(user.id, { isPlatformAdmin: checked })}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
