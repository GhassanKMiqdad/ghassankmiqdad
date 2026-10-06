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
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { teamFormSchema, type TeamFormValues } from "@/lib/validation/research";
import { createResearchTeamAction, updateResearchTeamAction } from "@/server/actions/research";
import type { ResearchTeam } from "@/types/research";

export function TeamFormDialog({
  projectId,
  team,
  trigger,
}: {
  projectId: string;
  team?: ResearchTeam;
  trigger?: React.ReactNode;
}) {
  const { t, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: { name: team?.name ?? "", description: team?.description ?? "" },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = team
      ? await run(() => updateResearchTeamAction(team.id, values), { success: t.researchTeams.updated })
      : await run(() => createResearchTeamAction(projectId, values), { success: t.researchTeams.created });
    if (result?.ok) {
      setOpen(false);
      router.refresh();
    } else if (result) applyFieldErrors(result, form.setError);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus aria-hidden />
            {t.researchTeams.create}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{team ? t.researchTeams.editTitle : t.researchTeams.createTitle}</DialogTitle>
          <DialogDescription>{t.researchTeams.subtitle}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.researchTeams.name}</FormLabel>
                  <FormControl>
                    <Input maxLength={120} {...field} />
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
                  <FormLabel>{t.researchTeams.description}</FormLabel>
                  <FormControl>
                    <Textarea rows={4} maxLength={3000} {...field} />
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
                {t.common.saveChanges}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
