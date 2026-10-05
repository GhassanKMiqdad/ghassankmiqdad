import { describe, expect, it } from "vitest";

import {
  canReadSubmission,
  canSubmitTask,
  nextSubmissionVersion,
  sortSubmissionHistory,
  taskStatusForReview,
} from "@/lib/research-workflow";

describe("versioned research workflow", () => {
  it("starts history at v1 and links every later version to its immutable predecessor", () => {
    expect(nextSubmissionVersion(null)).toEqual({ versionNumber: 1, previousVersionId: null });
    expect(nextSubmissionVersion({ id: "sub-v1", versionNumber: 1 })).toEqual({
      versionNumber: 2,
      previousVersionId: "sub-v1",
    });
  });

  it("allows only the assigned researcher to submit from work/revision states", () => {
    expect(canSubmitTask("in_progress", "r1", "r1")).toBe(true);
    expect(canSubmitTask("revision_required", "r1", "r1")).toBe(true);
    expect(canSubmitTask("under_review", "r1", "r1")).toBe(false);
    expect(canSubmitTask("in_progress", "r2", "r1")).toBe(false);
    expect(canSubmitTask("assigned", "r1", "r1")).toBe(false);
  });

  it("maps durable review decisions to explicit task workflow states", () => {
    expect(taskStatusForReview("approved")).toBe("approved");
    expect(taskStatusForReview("revision_required")).toBe("revision_required");
    expect(taskStatusForReview("rejected")).toBe("cancelled");
  });

  it("keeps older versions available and sorts history deterministically", () => {
    const input = [
      { versionNumber: 1, createdAt: "2026-01-01T00:00:00.000Z", value: "v1" },
      { versionNumber: 3, createdAt: "2026-01-02T00:00:00.000Z", value: "v3" },
      { versionNumber: 2, createdAt: "2026-01-03T00:00:00.000Z", value: "v2" },
    ];
    expect(sortSubmissionHistory(input).map((item) => item.value)).toEqual(["v3", "v2", "v1"]);
    expect(input).toHaveLength(3);
  });

  it("limits private submission history to its owner unless task access permits review", () => {
    expect(canReadSubmission("r1", "r1", false, false)).toBe(true);
    expect(canReadSubmission("r1", "r2", false, false)).toBe(false);
    expect(canReadSubmission("reviewer", "r2", true, false)).toBe(true);
    expect(canReadSubmission("director", "r2", false, true)).toBe(true);
  });
});
