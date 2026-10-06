"use client";

import { useRouter } from "next/navigation";
import { Archive, Loader2 } from "lucide-react";

import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { archiveResearchTeamAction } from "@/server/actions/research";

export function ArchiveTeamButton({ teamId }: { teamId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const archive = async () => {
    const result = await run(() => archiveResearchTeamAction(teamId), { success: t.researchTeams.archivedToast });
    if (result?.ok) router.refresh();
  };
  return (
    <Button
      type="button"
      variant="outline"
      className="text-destructive"
      disabled={pending}
      onClick={() => void archive()}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Archive aria-hidden />}
      {t.researchTeams.archive}
    </Button>
  );
}
