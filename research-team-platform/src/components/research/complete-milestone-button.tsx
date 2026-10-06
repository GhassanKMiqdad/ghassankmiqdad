"use client";

import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { updateMilestoneAction } from "@/server/actions/research";
import type { ResearchMilestone } from "@/types/research";

export function CompleteMilestoneButton({ milestone }: { milestone: ResearchMilestone }) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const complete = async () => {
    const result = await run(
      () =>
        updateMilestoneAction(milestone.id, {
          name: milestone.name,
          description: milestone.description,
          deadline: milestone.deadline,
          responsibleTeamId: milestone.responsibleTeamId,
          responsibleResearcherId: milestone.responsibleResearcherId,
          status: "completed",
        }),
      { success: t.milestones.completedToast },
    );
    if (result?.ok) router.refresh();
  };
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void complete()}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
      {t.milestones.markComplete}
    </Button>
  );
}
