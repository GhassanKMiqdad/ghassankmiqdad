"use client";

import { useEffect, useState } from "react";

import type { DateStyle } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";

/** Absolute date in the application time zone (identical on server and client). */
export function DateText({
  value,
  style = "date",
  fallback,
  className,
}: {
  value: string | null | undefined;
  style?: DateStyle;
  fallback?: string;
  className?: string;
}) {
  const { date, t } = useI18n();
  if (!value) return <span className={className}>{fallback ?? t.common.notSet}</span>;
  return (
    <time dateTime={value} className={className}>
      {date(value, style)}
    </time>
  );
}

/**
 * "5 minutes ago". Renders the absolute timestamp first (deterministic for
 * hydration) and switches to relative time once mounted in the browser.
 */
export function RelativeTime({ value, className }: { value: string; className?: string }) {
  const { date, relative } = useI18n();
  const [label, setLabel] = useState(() => date(value, "datetime"));

  useEffect(() => {
    const update = () => setLabel(relative(value));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [value, relative]);

  return (
    <time dateTime={value} title={date(value, "datetime")} className={className}>
      {label}
    </time>
  );
}
