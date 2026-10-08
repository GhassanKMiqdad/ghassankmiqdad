"use client";

import { Download, Eye, FileText, Loader2 } from "lucide-react";

import { useOpenDocument } from "@/components/documents/use-open-document";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { formatBytes } from "@/lib/utils";
import type { TaskFileItem } from "@/types/app";

/**
 * Files the server already authorized for this viewer (RLS). Opening one asks
 * the server again for a 60-second signed URL.
 */
export function TaskFileList({
  files,
  actions,
}: {
  files: TaskFileItem[];
  actions?: (file: TaskFileItem) => React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const { open, opening } = useOpenDocument();
  if (files.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {files.map((file) => (
        <li key={file.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate font-medium">
              {file.title}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {file.fileName} · {formatBytes(file.sizeBytes, locale)}
            </span>
          </span>
          {actions?.(file)}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={opening === file.id}
            onClick={() => open(file.id, "view")}
            aria-label={t.taskFiles.view}
            title={t.taskFiles.view}
          >
            {opening === file.id ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={opening === file.id}
            onClick={() => open(file.id, "download")}
            aria-label={t.taskFiles.download}
            title={t.taskFiles.download}
          >
            <Download aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
