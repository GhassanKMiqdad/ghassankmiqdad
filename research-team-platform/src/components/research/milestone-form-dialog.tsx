"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2, Plus } from "lucide-react";

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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { milestoneFormSchema, type MilestoneFormInput, type MilestoneFormValues } from "@/lib/validation/research";
import { createMilestoneAction, updateMilestoneAction } from "@/server/actions/research";
import type { MemberOption } from "@/types/app";
import type { ResearchMilestone, ResearchTeam } from "@/types/research";

const NONE = "__none__";

export function MilestoneFormDialog({
  projectId,
  milestone,
  teams,
  members,
}: {
  projectId: string;
  milestone?: ResearchMilestone;
  teams: ResearchTeam[];
  members: MemberOption[];
}) {
  const { t, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<MilestoneFormInput, unknown, MilestoneFormValues>({
    resolver: zodResolver(milestoneFormSchema),
    defaultValues: {
      name: milestone?.name ?? "",
      description: milestone?.description ?? "",
      deadline: milestone?.deadline ?? null,
      responsibleTeamId: milestone?.responsibleTeamId ?? null,
      responsibleResearcherId: milestone?.responsibleResearcherId ?? null,
      status: milestone?.status ?? "pending",
    },
  });

  const submit = form.handleSubmit(async (values) => {
    const result = milestone
      ? await run(() => updateMilestoneAction(milestone.id, values), { success: t.milestones.updated })
      : await run(() => createMilestoneAction(projectId, values), { success: t.milestones.created });
    if (result?.ok) {
      setOpen(false);
      router.refresh();
    } else if (result) applyFieldErrors(result, form.setError);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={milestone ? "outline" : "default"}>
          {milestone ? (
            t.common.edit
          ) : (
            <>
              <Plus aria-hidden />
              {t.milestones.create}
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{milestone ? t.milestones.editTitle : t.milestones.createTitle}</DialogTitle>
          <DialogDescription>{t.milestones.subtitle}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.milestones.name}</FormLabel>
                  <FormControl>
                    <Input maxLength={160} {...field} />
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
                  <FormLabel>{t.milestones.description}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} maxLength={5000} {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="deadline"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.milestones.deadline}</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="responsibleTeamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.milestones.responsibleTeam}</FormLabel>
                    <Select
                      value={field.value ?? NONE}
                      onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>{t.milestones.noOwner}</SelectItem>
                        {teams
                          .filter((team) => team.status === "active")
                          .map((team) => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage localize={message} />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="responsibleResearcherId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.milestones.responsibleResearcher}</FormLabel>
                    <Select
                      value={field.value ?? NONE}
                      onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>{t.milestones.noOwner}</SelectItem>
                        {members.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage localize={message} />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.milestones.status}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="pending">{t.milestones.pending}</SelectItem>
                      <SelectItem value="in_progress">{t.milestones.inProgress}</SelectItem>
                      <SelectItem value="at_risk">{t.milestones.atRisk}</SelectItem>
                      <SelectItem value="completed">{t.milestones.completed}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {t.common.saveChanges}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
