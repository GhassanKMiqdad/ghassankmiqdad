"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const ANY = "__any__";

export function ReportFilters({ projects }: { projects: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === ANY) params.delete(key);
    else params.set(key, value);
    startTransition(() => router.replace(params.size ? `${pathname}?${params}` : pathname));
  };

  return (
    <div className={cn("flex flex-wrap gap-2 transition-opacity", pending && "opacity-60")}>
      {projects.length > 1 ? (
        <Select value={searchParams.get("project") ?? ANY} onValueChange={(value) => update("project", value)}>
          <SelectTrigger className="w-52" aria-label={t.tasks.fields.project}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t.tasks.filters.anyProject}</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Select value={searchParams.get("month") ?? ANY} onValueChange={(value) => update("month", value)}>
        <SelectTrigger className="w-40" aria-label={t.tasks.fields.planningMonth}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t.reports.anyMonth}</SelectItem>
          {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
            <SelectItem key={month} value={String(month)}>
              {`M${String(month).padStart(2, "0")}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
