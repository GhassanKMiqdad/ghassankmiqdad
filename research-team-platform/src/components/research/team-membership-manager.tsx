"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, UserMinus } from "lucide-react";

import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import {
  addResearchTeamMemberAction,
  removeResearchTeamMemberAction,
  setResearchTeamLeadAction,
} from "@/server/actions/research";
import type { MemberOption } from "@/types/app";
import type { ResearchTeam, ResearchTeamMember } from "@/types/research";

const NONE = "__none__";

export function TeamMembershipManager({
  team,
  members,
  candidates,
}: {
  team: ResearchTeam;
  members: ResearchTeamMember[];
  candidates: MemberOption[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [candidate, setCandidate] = useState("");
  const currentIds = new Set(members.map((member) => member.userId));
  const available = candidates.filter((item) => !currentIds.has(item.id));

  const add = async () => {
    if (!candidate) return;
    const result = await run(() => addResearchTeamMemberAction(team.id, { userId: candidate }), {
      success: t.researchTeams.memberAdded,
    });
    if (result?.ok) {
      setCandidate("");
      router.refresh();
    }
  };

  const setLead = async (value: string) => {
    const result = await run(() => setResearchTeamLeadAction(team.id, { userId: value === NONE ? null : value }), {
      success: t.researchTeams.leadUpdated,
    });
    if (result?.ok) router.refresh();
  };

  const remove = async (userId: string) => {
    const result = await run(() => removeResearchTeamMemberAction(team.id, userId), {
      success: t.researchTeams.memberRemoved,
    });
    if (result?.ok) router.refresh();
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t.researchTeams.members}</h3>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.researchTeams.noMembers}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {members.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.fullName || member.email || member.userId}</p>
                  {member.email ? <p className="truncate text-xs text-muted-foreground">{member.email}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  {team.leadId === member.userId ? (
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs">{t.researchTeams.lead}</span>
                  ) : null}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={pending}
                    aria-label={t.researchTeams.removeMember}
                    onClick={() => void remove(member.userId)}
                  >
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <UserMinus className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Select value={candidate} onValueChange={setCandidate}>
          <SelectTrigger aria-label={t.researchTeams.chooseMember}>
            <SelectValue placeholder={t.researchTeams.chooseMember} />
          </SelectTrigger>
          <SelectContent>
            {available.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" onClick={() => void add()} disabled={pending || !candidate || team.status !== "active"}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t.researchTeams.addMember}
        </Button>
      </section>
      <section className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold">{t.researchTeams.lead}</h3>
        <Select
          value={team.leadId ?? NONE}
          onValueChange={(value) => void setLead(value)}
          disabled={pending || team.status !== "active"}
        >
          <SelectTrigger>
            <SelectValue placeholder={t.researchTeams.chooseLead} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t.researchTeams.chooseLead}</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.fullName || member.email || member.userId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>
    </div>
  );
}
