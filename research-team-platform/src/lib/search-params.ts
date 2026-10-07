import { z } from "zod";

import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/permissions/catalog";

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
const uuidOrUndefined = z.uuid().optional().catch(undefined);

const dateOrUndefined = z.iso.date().optional().catch(undefined);
const scheduleFilter = z.enum(["overdue", "due_soon", "unscheduled"]).optional().catch(undefined);

/** Untrusted URL filters -> validated task filters. */
export function parseTaskSearchParams(params: RawParams) {
  const assignee = first(params.assignee);
  return {
    q: z.string().max(100).optional().catch(undefined).parse(first(params.q)),
    status: z.enum(TASK_STATUSES).optional().catch(undefined).parse(first(params.status)),
    priority: z.enum(TASK_PRIORITIES).optional().catch(undefined).parse(first(params.priority)),
    assignee: assignee === "me" || assignee === "unassigned" ? assignee : uuidOrUndefined.parse(assignee),
    project: uuidOrUndefined.parse(first(params.project)),
    team: uuidOrUndefined.parse(first(params.team)),
    month: z.coerce.number().int().min(1).max(99).optional().catch(undefined).parse(first(params.month)),
    week: z.coerce.number().int().min(1).max(5).optional().catch(undefined).parse(first(params.week)),
    from: dateOrUndefined.parse(first(params.from)),
    to: dateOrUndefined.parse(first(params.to)),
    // "overdue=1" is the link format used before the schedule filter existed.
    schedule: scheduleFilter.parse(first(params.schedule) ?? (first(params.overdue) === "1" ? "overdue" : undefined)),
    page: pageSchema.parse(first(params.page) ?? 1),
  };
}

/** Calendar view state from the URL. */
export function parseScheduleSearchParams(params: RawParams) {
  const assignee = first(params.assignee);
  return {
    view: z
      .enum(["month", "week"])
      .catch("month")
      .parse(first(params.view) ?? "month"),
    date: dateOrUndefined.parse(first(params.date)),
    project: uuidOrUndefined.parse(first(params.project)),
    team: uuidOrUndefined.parse(first(params.team)),
    assignee: assignee === "me" ? ("me" as const) : uuidOrUndefined.parse(assignee),
  };
}

export function parseActivitySearchParams(params: RawParams, entityTypes: readonly string[]) {
  const entity = first(params.entity);
  return {
    project: uuidOrUndefined.parse(first(params.project)),
    entity: entity && entityTypes.includes(entity) ? entity : undefined,
    page: pageSchema.parse(first(params.page) ?? 1),
  };
}

export function parsePageParam(params: RawParams) {
  return {
    page: pageSchema.parse(first(params.page) ?? 1),
    q: z.string().max(100).optional().catch(undefined).parse(first(params.q)),
    project: uuidOrUndefined.parse(first(params.project)),
  };
}
