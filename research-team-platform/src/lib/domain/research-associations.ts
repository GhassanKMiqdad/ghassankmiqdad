export type MilestoneAssociationError = "team_project_mismatch" | "researcher_not_active" | "researcher_not_in_team";

export function isValidTeamLead(
  leadId: string | null,
  memberIds: readonly string[],
  activeProjectMemberIds: ReadonlySet<string>,
) {
  return leadId === null || (memberIds.includes(leadId) && activeProjectMemberIds.has(leadId));
}

export function canSeeTeam(userId: string, memberIds: readonly string[], mayViewAllTeams: boolean) {
  return mayViewAllTeams || memberIds.includes(userId);
}

export function canSeeMilestone(
  userId: string,
  researcherIds: readonly string[],
  teamId: string | null,
  visibleTeamIds: ReadonlySet<string>,
  mayViewAllMilestones: boolean,
) {
  return mayViewAllMilestones || researcherIds.includes(userId) || (!!teamId && visibleTeamIds.has(teamId));
}

export function validateMilestoneAssociations(input: {
  hasTeam: boolean;
  teamProjectMatches: boolean;
  teamMemberIds: readonly string[];
  researcherIds: readonly string[];
  activeProjectMemberIds: ReadonlySet<string>;
}): MilestoneAssociationError | null {
  if (input.hasTeam && !input.teamProjectMatches) return "team_project_mismatch";
  for (const id of input.researcherIds) {
    if (!input.activeProjectMemberIds.has(id)) return "researcher_not_active";
    if (input.hasTeam && !input.teamMemberIds.includes(id)) return "researcher_not_in_team";
  }
  return null;
}
