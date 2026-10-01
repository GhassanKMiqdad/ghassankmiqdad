"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import type { ProjectRole } from "@/lib/permissions/catalog";
import { addMemberSchema, type AddMemberInput } from "@/lib/validation/member";
import { addMemberAction } from "@/server/actions/members";

export function AddMemberDialog({ projectId, roles }: { projectId: string; roles: ProjectRole[] }) {
  const { t, fmt, message } = useI18n();
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const defaultRole = (roles.includes("member") ? "member" : roles[0]) as AddMemberInput["role"];

  const form = useForm<AddMemberInput>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: "", role: defaultRole },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await run(() => addMemberAction(projectId, values));
    if (result?.ok) {
      toast.success(
        result.data.status === "invited"
          ? fmt(t.team.memberInvited, { email: result.data.email })
          : fmt(t.team.memberAdded, { email: result.data.email }),
      );
      setOpen(false);
      form.reset({ email: "", role: defaultRole });
    } else applyFieldErrors(result, form.setError);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          {t.team.addMember}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.team.addMemberTitle}</DialogTitle>
          <DialogDescription>{t.team.addMemberDescription}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.team.email}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      dir="ltr"
                      autoComplete="off"
                      placeholder="colleague@university.edu"
                      {...field}
                    />
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
                  <FormLabel>{t.team.role}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role} value={role}>
                          {t.roles[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t.roleDescriptions[field.value]}</FormDescription>
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
                {t.common.add}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
