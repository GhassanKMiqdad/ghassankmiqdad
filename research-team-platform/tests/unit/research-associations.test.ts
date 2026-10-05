import { describe, expect, it } from "vitest";

import {
  canSeeMilestone,
  canSeeTeam,
  isValidTeamLead,
  validateMilestoneAssociations,
} from "@/lib/domain/research-associations";

describe("research team and milestone associations", () => {
  const active = new Set(["r1", "r2"]);

  it("only allows an active project member who is already on the team to lead it", () => {
    expect(isValidTeamLead("r1", ["r1", "r2"], active)).toBe(true);
    expect(isValidTeamLead("r3", ["r3"], active)).toBe(false);
    expect(isValidTeamLead("r2", ["r1"], active)).toBe(false);
    expect(isValidTeamLead(null, [], active)).toBe(true);
  });

  it("rejects team/project mismatches and inactive or non-team researchers", () => {
    expect(
      validateMilestoneAssociations({
        hasTeam: true,
        teamProjectMatches: false,
        teamMemberIds: ["r1"],
        researcherIds: ["r1"],
        activeProjectMemberIds: active,
      }),
    ).toBe("team_project_mismatch");
    expect(
      validateMilestoneAssociations({
        hasTeam: false,
        teamProjectMatches: true,
        teamMemberIds: [],
        researcherIds: ["r3"],
        activeProjectMemberIds: active,
      }),
    ).toBe("researcher_not_active");
    expect(
      validateMilestoneAssociations({
        hasTeam: true,
        teamProjectMatches: true,
        teamMemberIds: ["r1"],
        researcherIds: ["r2"],
        activeProjectMemberIds: active,
      }),
    ).toBe("researcher_not_in_team");
  });

  it("accepts valid project and team associations", () => {
    expect(
      validateMilestoneAssociations({
        hasTeam: true,
        teamProjectMatches: true,
        teamMemberIds: ["r1", "r2"],
        researcherIds: ["r2"],
        activeProjectMemberIds: active,
      }),
    ).toBeNull();
  });

  it("isolates team and milestone views to explicit assignments", () => {
    const visibleTeams = new Set(["team-a"]);
    expect(canSeeTeam("r1", ["r1", "r2"], false)).toBe(true);
    expect(canSeeTeam("r1", ["r3"], false)).toBe(false);
    expect(canSeeTeam("director", ["r3"], true)).toBe(true);
    expect(canSeeMilestone("r1", [], "team-a", visibleTeams, false)).toBe(true);
    expect(canSeeMilestone("r1", ["r1"], "team-b", visibleTeams, false)).toBe(true);
    expect(canSeeMilestone("r1", ["r2"], "team-b", visibleTeams, false)).toBe(false);
    expect(canSeeMilestone("director", [], null, visibleTeams, true)).toBe(true);
  });
});
