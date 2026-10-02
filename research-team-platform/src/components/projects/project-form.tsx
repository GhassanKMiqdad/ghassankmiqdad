"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { applyFieldErrors, useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/permissions/catalog";
import { projectFormSchema, type ProjectFormInput, type ProjectFormValues } from "@/lib/validation/project";
import { createProjectAction, updateProjectAction } from "@/server/actions/projects";

export type ProjectFormDefaults = {
  name: string;
  description: string;
  researchGoal: string;
  status: ProjectStatus;
  startDate: string | null;
  deadline: string | null;
};

export function ProjectForm({
  mode,
  projectId,
  defaults,
  readOnly = false,
}: {
  mode: "create" | "edit";
  projectId?: string;
  defaults?: ProjectFormDefaults;
  readOnly?: boolean;
}) {
  const { t, message } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();

  const form = useForm<ProjectFormInput, unknown, ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: defaults?.name ?? "",
      description: defaults?.description ?? "",
      researchGoal: defaults?.researchGoal ?? "",
      status: defaults?.status ?? "planning",
      startDate: defaults?.startDate ?? "",
      deadline: defaults?.deadline ?? "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (mode === "create") {
      const result = await run(() => createProjectAction(values), { success: t.projects.created });
      if (result?.ok) router.push(`/projects/${result.data.projectId}`);
      else applyFieldErrors(result, form.setError);
    } else if (projectId) {
      const result = await run(() => updateProjectAction(projectId, values), { success: t.projects.updated });
      if (result && !result.ok) applyFieldErrors(result, form.setError);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <fieldset disabled={readOnly || pending} className="space-y-5">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.projects.fields.name}</FormLabel>
                <FormControl>
                  <Input placeholder={t.projects.placeholders.name} {...field} />
                </FormControl>
                <FormMessage localize={message} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="researchGoal"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.projects.fields.researchGoal}</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder={t.projects.placeholders.researchGoal} {...field} />
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
                <FormLabel>{t.projects.fields.description}</FormLabel>
                <FormControl>
                  <Textarea rows={5} placeholder={t.projects.placeholders.description} {...field} />
                </FormControl>
                <FormMessage localize={message} />
              </FormItem>
            )}
          />
          <div className="grid gap-5 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.projects.fields.status}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={readOnly || pending}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PROJECT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {t.projectStatus[status]}
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
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.projects.fields.startDate}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value ?? ""} />
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
                  <FormLabel>{t.projects.fields.deadline}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage localize={message} />
                </FormItem>
              )}
            />
          </div>
        </fieldset>
        {!readOnly ? (
          <div className="flex justify-end gap-2">
            {mode === "create" ? (
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
                {t.common.cancel}
              </Button>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {mode === "create" ? t.common.create : t.common.saveChanges}
            </Button>
          </div>
        ) : null}
      </form>
    </Form>
  );
}
