"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import { deleteProjectAction, transferOwnershipAction } from "@/server/actions/projects";
import type { MemberOption } from "@/types/app";

export function TransferOwnership({ projectId, candidates }: { projectId: string; candidates: MemberOption[] }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const { run } = useServerAction();
  const [newOwner, setNewOwner] = useState<string>("");
  const selected = candidates.find((candidate) => candidate.id === newOwner);

  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.projects.settings.noCandidates}</p>;
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-2">
        <Label htmlFor="new-owner">{t.projects.settings.newOwner}</Label>
        <Select value={newOwner} onValueChange={setNewOwner}>
          <SelectTrigger id="new-owner" className="w-full">
            <SelectValue placeholder={t.projects.settings.chooseMember} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name} · {t.roles[candidate.role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ConfirmDialog
        trigger={
          <Button variant="outline" disabled={!selected}>
            <Crown aria-hidden />
            {t.projects.settings.transferAction}
          </Button>
        }
        title={t.projects.settings.transferTitle}
        description={selected ? fmt(t.projects.settings.transferConfirm, { name: selected.name }) : undefined}
        confirmLabel={t.projects.settings.transferAction}
        onConfirm={async () => {
          if (!selected) return false;
          const result = await run(() => transferOwnershipAction(projectId, { newOwnerId: selected.id }), {
            success: t.projects.settings.transferred,
          });
          if (result?.ok) router.refresh();
          return !!result?.ok;
        }}
      />
    </div>
  );
}

export function DeleteProject({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const { run } = useServerAction();
  const [confirmation, setConfirmation] = useState("");

  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive">
          <Trash2 aria-hidden />
          {t.projects.deleteAction}
        </Button>
      }
      title={t.projects.deleteTitle}
      description={t.projects.deleteDescription}
      confirmLabel={t.projects.deleteAction}
      onConfirm={async () => {
        const result = await run(() => deleteProjectAction(projectId, { confirmation }));
        if (result?.ok) {
          toast.success(t.projects.deleted);
          router.push("/projects");
        }
        return !!result?.ok;
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="delete-confirmation">{fmt(t.projects.deleteConfirmLabel, { name: projectName })}</Label>
        <Input
          id="delete-confirmation"
          value={confirmation}
          autoComplete="off"
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}
