import Link from "next/link";
import { FlaskConical } from "lucide-react";

import { cn } from "@/lib/utils";

export function Brand({ name, href = "/workspace", className }: { name: string; href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <FlaskConical className="size-4.5" aria-hidden />
      </span>
      <span className="truncate">{name}</span>
    </Link>
  );
}
