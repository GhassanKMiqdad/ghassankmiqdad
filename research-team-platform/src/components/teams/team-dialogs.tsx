"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { TEAM_ROLES } from "@/lib/permissions/catalog";
import {
  linkMemberSchema,
  teamMemberSchema,
  teamSchema,
  type TeamInput,
  type TeamMemberInput,
  type TeamMemberValues,
} from "@/lib/validation/task";
import { createTeamAction, linkTeamMemberAction, saveTeamMemberAction, updateTeamAction } from "@/server/actions/teams";
import type { TeamRosterMember } from "@/types/app";

export function TeamDialog({
  team,
  trigger,
}: {
  team?: { id: string; name: string; description: string };
  trigger: ReactNode;
}) {
  const { t, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<TeamInput>({
    resolver: zodResolver(teamSchema),
    defaultValues: { name: team?.name ?? "", description: team?.description ?? "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const result = team
      ? await run(() => updateTeamAction(team.id, values), { success: t.teams.updated })
      : await run(() => createTeamAction(values), { success: t.teams.created });
    if (result?.ok) {
      setOpen(false);
      if (!team) form.reset();
      router.refresh();
    } else applyFieldErrors(result, form.setError);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{team ? t.teams.editTitle : t.teams.createTitle}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.teams.name}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.teams.description}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t.common.save}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function TeamMemberDialog({
  teamId,
  member,
  trigger,
}: {
  teamId: string;
  member?: TeamRosterMember;
  trigger: ReactNode;
}) {
  const { t, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<TeamMemberInput, unknown, TeamMemberValues>({
    resolver: zodResolver(teamMemberSchema),
    defaultValues: {
      displayName: member?.displayName ?? "",
      memberCode: member?.memberCode ?? "",
      jobTitle: member?.jobTitle ?? "",
      role: member?.role ?? "team_member",
      inviteEmail: member?.inviteEmail ?? "",
    },
  });

  const onSubmit = form.handleSubmit(async () => {
    const result = await run(() => saveTeamMemberAction(teamId, member?.id ?? null, form.getValues()), {
      success: t.teams.memberSaved,
    });
    if (result?.ok) {
      setOpen(false);
      if (!member) form.reset();
      router.refresh();
    } else applyFieldErrors(result, form.setError);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{member ? t.teams.editMember : t.teams.addMember}</DialogTitle>
          <DialogDescription>{t.teams.rosterDescription}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.teams.displayName}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage localize={message} />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="memberCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.teams.memberCode}</FormLabel>
                    <FormControl>
                      <Input dir="ltr" className="font-mono uppercase" maxLength={4} placeholder="GH" {...field} />
                    </FormControl>
                    <FormMessage localize={message} />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="jobTitle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.teams.jobTitle}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.teams.teamRole}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TEAM_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {t.orgRoles[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t.orgRoles.descriptions[field.value ?? "team_member"]}</FormDescription>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="inviteEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t.teams.inviteEmail} <span className="text-muted-foreground">({t.common.optional})</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="email" dir="ltr" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormDescription>{t.teams.inviteEmailHint}</FormDescription>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t.common.save}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function LinkAccountDialog({ member, trigger }: { member: TeamRosterMember; trigger: ReactNode }) {
  const { t, fmt, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<{ email: string }>({
    resolver: zodResolver(linkMemberSchema),
    defaultValues: { email: member.inviteEmail ?? "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await run(() => linkTeamMemberAction(member.id, values), { success: t.teams.linked });
    if (result?.ok) {
      setOpen(false);
      router.refresh();
    } else applyFieldErrors(result, form.setError);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{fmt(t.teams.linkTitle, { name: member.displayName })}</DialogTitle>
          <DialogDescription>{t.teams.linkDescription}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.common.email}</FormLabel>
                  <FormControl>
                    <Input type="email" dir="ltr" {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t.teams.linkAccount}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
