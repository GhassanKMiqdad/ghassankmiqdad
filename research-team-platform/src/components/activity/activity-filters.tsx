"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const ANY = "__any__";

export function ActivityFilters({
  entityTypes,
  projects,
}: {
  entityTypes: readonly string[];
  projects?: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === ANY) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startTransition(() => router.replace(params.size ? `${pathname}?${params}` : pathname));
  };

  return (
    <div className={cn("flex flex-wrap gap-2 transition-opacity", pending && "opacity-60")}>
      {projects && projects.length > 1 ? (
        <Select value={searchParams.get("project") ?? ANY} onValueChange={(value) => update("project", value)}>
          <SelectTrigger className="w-52" aria-label={t.common.project}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t.activity.filters.anyProject}</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Select value={searchParams.get("entity") ?? ANY} onValueChange={(value) => update("entity", value)}>
        <SelectTrigger className="w-44" aria-label={t.activity.filters.anyEntity}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t.activity.filters.anyEntity}</SelectItem>
          {entityTypes.map((type) => (
            <SelectItem key={type} value={type}>
              {(t.activity.entities as Record<string, string>)[type] ?? type}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
