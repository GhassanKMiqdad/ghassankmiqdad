import "server-only";

import { getAppTimeZone } from "@/lib/env.server";
import { todayInTimeZone } from "@/lib/i18n/format";
import { isRecord } from "@/lib/utils";
import type { UserRef } from "@/types/app";

type ProfileEmbed = { id: string; full_name: string; email: string | null } | null;

export function toUserRef(profile: ProfileEmbed): UserRef | null {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.full_name?.trim() || profile.email || "—",
    email: profile.email,
  };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** Today's date in the application time zone (for "overdue"). */
export function appToday(): string {
  return todayInTimeZone(getAppTimeZone());
}

export function isOverdue(dueDate: string | null, status: string, today = appToday()): boolean {
  return !!dueDate && dueDate < today && status !== "completed" && status !== "rejected";
}

/** Removes LIKE / PostgREST wildcard characters from free-text search. */
export function sanitizeSearch(value: string | undefined | null): string | null {
  const cleaned = (value ?? "")
    .replace(/[%_*\\,()"':]/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned.length > 0 ? cleaned : null;
}

export function pageRange(page: number, pageSize: number) {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * pageSize;
  return { page: safePage, from, to: from + pageSize - 1 };
}

export const PROFILE_FIELDS = "id, full_name, email";
