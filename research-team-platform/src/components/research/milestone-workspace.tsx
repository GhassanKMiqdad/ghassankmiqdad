"use client";

import type { FormEvent } from "react";

import {
  archiveMilestoneAction,
  createMilestoneAction,
  setMilestoneStatusAction,
  updateMilestoneAction,
} from "@/server/actions/research";
import { useServerAction } from "@/components/shared/use-action";
import { useI18n } from "@/lib/i18n/provider";
import type { ProjectMilestone, ProjectResearcher, ProjectTeam } from "@/types/research";

const fieldClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const buttonClass = "rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

type Props = {
  projectId: string;
  milestones: ProjectMilestone[];
  teams: ProjectTeam[];
  researchers: ProjectResearcher[];
  canManage: boolean;
};

type MilestoneValues = {
  title: string;
  description: string;
  dueDate: string;
  teamId: string | null;
  researcherIds: string[];
};
function formValues(form: HTMLFormElement): MilestoneValues {
  const values = new FormData(form);
  return {
    title: String(values.get("title") ?? ""),
    description: String(values.get("description") ?? ""),
    dueDate: String(values.get("dueDate") ?? ""),
    teamId: String(values.get("teamId") ?? "") || null,
    researcherIds: values.getAll("researcherIds").map(String),
  };
}

export function MilestoneWorkspace({ projectId, milestones, teams, researchers, canManage }: Props) {
  const { t } = useI18n();
  const { pending, run } = useServerAction();
  const activeTeams = teams.filter((team) => team.status === "active");
  const researcherNames = new Map(researchers.map((researcher) => [researcher.id, researcher.name]));
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void run(() => createMilestoneAction(projectId, formValues(form))).then((result) => {
      if (result?.ok) form.reset();
    });
  }

  return (
    <div className="space-y-5">
      {canManage ? (
        <form onSubmit={create} className="grid gap-3 rounded-xl border bg-card p-4 lg:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            <span>{t.research.milestoneTitle}</span>
            <input name="title" required minLength={2} maxLength={120} className={fieldClass} />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>{t.research.dueDate}</span>
            <input name="dueDate" type="date" className={fieldClass} />
          </label>
          <label className="space-y-1 text-sm font-medium lg:col-span-2">
            <span>{t.research.description}</span>
            <textarea name="description" maxLength={5000} rows={2} className={fieldClass} />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>{t.research.assignedTeam}</span>
            <select name="teamId" className={fieldClass}>
              <option value="">{t.research.noTeam}</option>
              {activeTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>{t.research.researchers}</span>
            <select name="researcherIds" multiple className={fieldClass} size={4}>
              {researchers.map((researcher) => (
                <option key={researcher.id} value={researcher.id}>
                  {researcher.name}
                </option>
              ))}
            </select>
            <span className="block text-xs font-normal text-muted-foreground">{t.research.selectResearchersHint}</span>
          </label>
          <div className="lg:col-span-2">
            <button className={buttonClass} disabled={pending}>
              {t.research.createMilestone}
            </button>
          </div>
        </form>
      ) : null}

      {milestones.length === 0 ? (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">{t.research.emptyMilestones}</p>
      ) : null}
      {milestones.map((milestone) => (
        <section key={milestone.id} className="space-y-4 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">{milestone.title}</h2>
              <p className="text-sm text-muted-foreground">{milestone.description || t.common.noDescription}</p>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-xs">
              {milestone.status === "open"
                ? t.research.open
                : milestone.status === "completed"
                  ? t.research.completed
                  : t.research.archived}
            </span>
          </div>
          {!canManage || milestone.status === "archived" ? (
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span>
                {t.research.dueDate}: {milestone.dueDate || t.common.notSet}
              </span>
              <span>
                {t.research.assignedTeam}:{" "}
                {milestone.teamId ? (teamNames.get(milestone.teamId) ?? milestone.teamId) : t.research.noTeam}
              </span>
              <span>
                {t.research.researchers}:{" "}
                {milestone.researcherIds.map((id) => researcherNames.get(id) ?? id).join(", ") || "—"}
              </span>
            </div>
          ) : (
            <form
              className="grid gap-3 lg:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const values = formValues(event.currentTarget);
                void run(() => updateMilestoneAction(milestone.id, values));
              }}
            >
              <label className="space-y-1 text-sm font-medium">
                <span>{t.research.milestoneTitle}</span>
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={milestone.title}
                  className={fieldClass}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>{t.research.dueDate}</span>
                <input name="dueDate" type="date" defaultValue={milestone.dueDate ?? ""} className={fieldClass} />
              </label>
              <label className="space-y-1 text-sm font-medium lg:col-span-2">
                <span>{t.research.description}</span>
                <textarea
                  name="description"
                  maxLength={5000}
                  rows={2}
                  defaultValue={milestone.description}
                  className={fieldClass}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>{t.research.assignedTeam}</span>
                <select name="teamId" defaultValue={milestone.teamId ?? ""} className={fieldClass}>
                  <option value="">{t.research.noTeam}</option>
                  {activeTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>{t.research.researchers}</span>
                <select
                  name="researcherIds"
                  multiple
                  defaultValue={milestone.researcherIds}
                  className={fieldClass}
                  size={4}
                >
                  {researchers.map((researcher) => (
                    <option key={researcher.id} value={researcher.id}>
                      {researcher.name}
                    </option>
                  ))}
                </select>
                <span className="block text-xs font-normal text-muted-foreground">
                  {t.research.selectResearchersHint}
                </span>
              </label>
              <div className="flex flex-wrap gap-2 lg:col-span-2">
                <button className={buttonClass} disabled={pending}>
                  {t.research.saveMilestone}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={pending}
                  onClick={() =>
                    void run(() =>
                      setMilestoneStatusAction(milestone.id, milestone.status === "completed" ? "open" : "completed"),
                    )
                  }
                >
                  {milestone.status === "completed" ? t.research.reopen : t.research.complete}
                </button>
                <button
                  type="button"
                  className={`${buttonClass} text-destructive`}
                  disabled={pending}
                  onClick={() => void run(() => archiveMilestoneAction(milestone.id))}
                >
                  {t.research.archiveMilestone}
                </button>
              </div>
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
