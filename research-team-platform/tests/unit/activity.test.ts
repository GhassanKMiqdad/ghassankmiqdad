import { describe, expect, it } from "vitest";

import { activityChanges, describeActivity as describeIsolated, isolate } from "@/lib/activity";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import type { ActivityItem } from "@/types/app";

/** Summaries isolate user-provided names; compare the visible text. */
const describeActivity = (...args: Parameters<typeof describeIsolated>) =>
  describeIsolated(...args).replace(/[\u2068\u2069]/g, "");

function item(partial: Partial<ActivityItem>): ActivityItem {
  return {
    id: "1",
    projectId: "p",
    projectName: "Project",
    actorId: "u",
    actorName: "Ghassan",
    action: "task.updated",
    entityType: "task",
    entityId: "t",
    entityLabel: "Literature Review",
    oldValues: null,
    newValues: null,
    metadata: {},
    ipAddress: null,
    userAgent: null,
    createdAt: "2026-10-01T23:15:00Z",
    ...partial,
  };
}

const formatters = (t: typeof en) => ({ t, date: (value: string) => value, locale: "en" });

describe("activity descriptions", () => {
  it("describes a status change exactly like the specification example", () => {
    const entry = item({ oldValues: { status: "in_progress" }, newValues: { status: "completed" } });
    expect(describeActivity(entry, en)).toBe("Ghassan edited task “Literature Review”");
    expect(describeActivity(entry, ar)).toBe("عدّل Ghassan المهمة «Literature Review»");
    expect(describeIsolated(entry, ar)).toBe(`عدّل ${isolate("Ghassan")} المهمة «${isolate("Literature Review")}»`);
    expect(activityChanges(entry, formatters(en))).toEqual([
      { field: "status", label: "Status", before: "In progress", after: "Completed" },
    ]);
  });

  it("shows permission changes as granted / revoked", () => {
    const entry = item({
      action: "permissions.changed",
      entityType: "permissions",
      entityLabel: "Ahmad",
      oldValues: { "tasks.edit": false },
      newValues: { "tasks.edit": true },
    });
    expect(describeActivity(entry, en)).toBe("Ghassan changed the permissions of Ahmad");
    expect(activityChanges(entry, formatters(en))).toEqual([
      { field: "tasks.edit", label: "Plan & Edit Tasks", before: "Revoked", after: "Granted" },
    ]);
  });

  it("uses assignee names for assignment changes and System for service actions", () => {
    const entry = item({
      action: "task.assigned",
      actorName: null,
      oldValues: { assigned_to: null, assignee_name: null },
      newValues: { assigned_to: "x", assignee_name: "Sara" },
    });
    expect(describeActivity(entry, en)).toBe("System changed the assignee of “Literature Review”");
    expect(activityChanges(entry, formatters(en))).toEqual([
      { field: "assigned_to", label: "Assignee", before: null, after: "Sara" },
    ]);
  });
});
