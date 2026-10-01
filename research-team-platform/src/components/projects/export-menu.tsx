"use client";

import { Download, FileJson, FileSpreadsheet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/provider";

/** Shown only with data.export; the export route re-checks and audits it. */
export function ExportMenu({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const base = `/api/projects/${projectId}/export`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download aria-hidden />
          {t.projects.export.title}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`${base}?format=csv`} download>
            <FileSpreadsheet aria-hidden />
            {t.projects.export.tasksCsv}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${base}?format=json`} download>
            <FileJson aria-hidden />
            {t.projects.export.projectJson}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
