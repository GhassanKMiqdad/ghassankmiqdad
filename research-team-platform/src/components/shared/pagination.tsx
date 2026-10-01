"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const { t, fmt } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const hrefFor = (target: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (target <= 1) params.delete("page");
    else params.set("page", String(target));
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return (
    <nav className="flex items-center justify-between gap-2 pt-4" aria-label="pagination">
      <p className="text-sm text-muted-foreground tabular-nums">{fmt(t.common.pageOf, { page, total: pages })}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild disabled={page <= 1} aria-disabled={page <= 1}>
          <Link href={hrefFor(page - 1)} className={page <= 1 ? "pointer-events-none opacity-50" : undefined}>
            <ChevronLeft className="rtl:rotate-180" aria-hidden />
            {t.common.previous}
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild aria-disabled={page >= pages}>
          <Link href={hrefFor(page + 1)} className={page >= pages ? "pointer-events-none opacity-50" : undefined}>
            {t.common.next}
            <ChevronRight className="rtl:rotate-180" aria-hidden />
          </Link>
        </Button>
      </div>
    </nav>
  );
}
