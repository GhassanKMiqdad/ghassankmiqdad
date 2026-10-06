"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

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
import { useI18n } from "@/lib/i18n/provider";
import { addMemberSchema, type AddMemberInput } from "@/lib/validation/member";
import { addMemberAction } from "@/server/actions/members";
import type { ProjectListItem } from "@/types/app";

export function ResearcherInviteDialog({ projects }: { projects: ProjectListItem[] }) {
  const { t, fmt, message } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const { pending, run } = useServerAction();
  const form = useForm<AddMemberInput>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: "", role: "member" },
  });
  const submit = form.handleSubmit(async (values) => {
    if (!projectId) return;
    const result = await run(() => addMemberAction(projectId, { email: values.email, role: "member" }));
    if (result?.ok) {
      toast.success(
        result.data.status === "invited"
          ? fmt(t.team.memberInvited, { email: result.data.email })
          : fmt(t.team.memberAdded, { email: result.data.email }),
      );
      setOpen(false);
      form.reset({ email: "", role: "member" });
      router.refresh();
    } else applyFieldErrors(result, form.setError);
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button disabled={projects.length === 0}>
          <UserPlus aria-hidden />
          {t.researchers.invite}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.researchers.invite}</DialogTitle>
          <DialogDescription>{t.researchers.inviteHint}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <FormLabel>{t.common.project}</FormLabel>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.researchers.email}</FormLabel>
                  <FormControl>
                    <Input type="email" dir="ltr" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending || !projectId}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {t.common.add}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
