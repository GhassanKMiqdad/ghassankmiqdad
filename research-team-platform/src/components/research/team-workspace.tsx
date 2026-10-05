"use client";

import { useState, type FormEvent } from "react";

import {
  addTeamMemberAction,
  archiveTeamAction,
  createTeamAction,
  removeTeamMemberAction,
  setTeamLeadAction,
  updateTeamAction,
} from "@/server/actions/research";
import { useServerAction } from "@/components/shared/use-action";
import { useI18n } from "@/lib/i18n/provider";
import type { ProjectResearcher, ProjectTeam } from "@/types/research";

const fieldClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const buttonClass = "rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

type TeamWorkspaceProps = {
  projectId: string;
  teams: ProjectTeam[];
  researchers: ProjectResearcher[];
  canManage: boolean;
  canAddMembers: boolean;
  canRemoveMembers: boolean;
};

export function TeamWorkspace({
  projectId,
  teams,
  researchers,
  canManage,
  canAddMembers,
  canRemoveMembers,
}: TeamWorkspaceProps) {
  const { t } = useI18n();
  const { pending, run } = useServerAction();
  const [selectedResearcher, setSelectedResearcher] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const people = new Map(researchers.map((researcher) => [researcher.id, researcher]));

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void run(() => createTeamAction(projectId, { name: newName, description: newDescription })).then((result) => {
      if (result?.ok) {
        setNewName("");
        setNewDescription("");
        form.reset();
      }
    });
  }

  return (
    <div className="space-y-5">
      {canManage ? (
        <form
          onSubmit={create}
          className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
        >
          <label className="space-y-1 text-sm font-medium">
            <span>{t.research.teamName}</span>
            <input
              required
              minLength={2}
              maxLength={120}
              className={fieldClass}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>{t.research.description}</span>
            <input
              maxLength={5000}
              className={fieldClass}
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
            />
          </label>
          <button className={buttonClass} disabled={pending || newName.trim().length < 2}>
            {t.research.createTeam}
          </button>
        </form>
      ) : null}

      {teams.length === 0 ? (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">{t.research.emptyTeams}</p>
      ) : null}
      {teams.map((team) => {
        const available = researchers.filter((researcher) => !team.memberIds.includes(researcher.id));
        return (
          <section key={team.id} className="space-y-4 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">{team.name}</h2>
                <p className="text-sm text-muted-foreground">{team.description || t.common.noDescription}</p>
              </div>
              <span className="rounded-full border px-2.5 py-1 text-xs">
                {team.status === "active" ? t.research.active : t.research.archived}
              </span>
            </div>

            {canManage && team.status === "active" ? (
              <form
                className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const values = new FormData(form);
                  void run(() =>
                    updateTeamAction(projectId, team.id, {
                      name: String(values.get("name") ?? ""),
                      description: String(values.get("description") ?? ""),
                    }),
                  );
                }}
              >
                <label className="space-y-1 text-sm font-medium">
                  <span>{t.research.teamName}</span>
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={team.name}
                    className={fieldClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  <span>{t.research.description}</span>
                  <input name="description" maxLength={5000} defaultValue={team.description} className={fieldClass} />
                </label>
                <button className={buttonClass} disabled={pending}>
                  {t.research.saveTeam}
                </button>
              </form>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  {t.research.teamMembers} ({team.memberIds.length})
                </h3>
                {team.memberIds.length ? (
                  <ul className="space-y-2">
                    {team.memberIds.map((memberId) => (
                      <li
                        key={memberId}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        <span>
                          {people.get(memberId)?.name ?? memberId}
                          {team.leadId === memberId ? ` · ${t.research.lead}` : ""}
                        </span>
                        {canRemoveMembers && team.status === "active" ? (
                          <button
                            type="button"
                            className="text-xs text-destructive hover:underline"
                            disabled={pending}
                            onClick={() =>
                              void run(() => removeTeamMemberAction(projectId, team.id, { userId: memberId }))
                            }
                          >
                            {t.research.removeMember}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
                {canAddMembers && team.status === "active" && available.length ? (
                  <div className="flex gap-2">
                    <select
                      className={fieldClass}
                      value={selectedResearcher}
                      onChange={(event) => setSelectedResearcher(event.target.value)}
                    >
                      <option value="">{t.research.chooseResearcher}</option>
                      {available.map((researcher) => (
                        <option key={researcher.id} value={researcher.id}>
                          {researcher.name}
                          {researcher.email ? ` (${researcher.email})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={pending || !selectedResearcher}
                      onClick={() =>
                        void run(() => addTeamMemberAction(projectId, team.id, { userId: selectedResearcher })).then(
                          (result) => {
                            if (result?.ok) setSelectedResearcher("");
                          },
                        )
                      }
                    >
                      {t.research.addMember}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <label className="block space-y-1 text-sm font-medium">
                  <span>{t.research.lead}</span>
                  <select
                    className={fieldClass}
                    value={team.leadId ?? ""}
                    disabled={!canManage || team.status !== "active" || pending}
                    onChange={(event) =>
                      void run(() => setTeamLeadAction(projectId, team.id, { userId: event.target.value || null }))
                    }
                  >
                    <option value="">{t.research.noLead}</option>
                    {team.memberIds.map((id) => (
                      <option key={id} value={id}>
                        {people.get(id)?.name ?? id}
                      </option>
                    ))}
                  </select>
                </label>
                {canManage && team.status === "active" ? (
                  <button
                    type="button"
                    className={`${buttonClass} text-destructive`}
                    disabled={pending}
                    onClick={() => void run(() => archiveTeamAction(projectId, team.id))}
                  >
                    {t.research.archiveTeam}
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
