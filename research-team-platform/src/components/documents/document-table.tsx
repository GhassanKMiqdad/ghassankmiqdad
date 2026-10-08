"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import { useOpenDocument } from "@/components/documents/use-open-document";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DateText } from "@/components/shared/date-text";
import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fileKind, type FileKind } from "@/lib/files";
import { useI18n } from "@/lib/i18n/provider";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import { can } from "@/lib/permissions/policy";
import { formatBytes } from "@/lib/utils";
import { deleteDocumentAction, updateDocumentAction } from "@/server/actions/documents";
import type { DocumentItem } from "@/types/app";

const KIND_ICON: Record<FileKind, typeof File> = {
  pdf: FileText,
  sheet: FileSpreadsheet,
  image: FileImage,
  archive: FileArchive,
  code: FileCode,
  text: File,
};

export function DocumentTable({
  documents,
  accessByProject,
  showProject = false,
}: {
  documents: DocumentItem[];
  accessByProject: Record<string, ProjectAccessDTO>;
  showProject?: boolean;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const { open, opening } = useOpenDocument();
  const openDocument = (document: DocumentItem, mode: "view" | "download") => open(document.id, mode);

  return (
    <>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="ps-4">{t.documents.fields.title}</TableHead>
              {showProject ? <TableHead>{t.documents.fields.project}</TableHead> : null}
              <TableHead>{t.documents.fields.size}</TableHead>
              <TableHead>{t.documents.fields.uploadedBy}</TableHead>
              <TableHead>{t.documents.fields.uploadedAt}</TableHead>
              <TableHead className="w-12 pe-4">
                <span className="sr-only">{t.common.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((document) => {
              const access = accessByProject[document.projectId];
              const subject = access ? fromAccessDTO(access) : null;
              const Icon = KIND_ICON[fileKind(document.mimeType)];
              return (
                <TableRow key={document.id}>
                  <TableCell className="max-w-96 ps-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {opening === document.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Icon className="size-4" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => openDocument(document, "view")}
                          className="block max-w-full truncate text-start font-medium hover:underline"
                        >
                          {document.title}
                        </button>
                        <p className="truncate text-xs text-muted-foreground" dir="auto">
                          {document.fileName}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  {showProject ? (
                    <TableCell className="max-w-48 truncate text-muted-foreground">{document.projectName}</TableCell>
                  ) : null}
                  <TableCell className="tabular-nums">{formatBytes(document.sizeBytes, locale)}</TableCell>
                  <TableCell className="max-w-40 truncate">
                    {document.uploadedBy?.name ?? t.common.unknownUser}
                  </TableCell>
                  <TableCell>
                    <DateText value={document.createdAt} />
                  </TableCell>
                  <TableCell className="pe-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={t.common.actions}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openDocument(document, "view")}>
                          <Eye aria-hidden />
                          {t.common.view}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openDocument(document, "download")}>
                          <Download aria-hidden />
                          {t.common.download}
                        </DropdownMenuItem>
                        {can(subject, "documents.edit") ? (
                          <DropdownMenuItem onSelect={() => setEditing(document)}>
                            <Pencil aria-hidden />
                            {t.common.edit}
                          </DropdownMenuItem>
                        ) : null}
                        {can(subject, "documents.delete") ? (
                          <>
                            <DropdownMenuSeparator />
                            <DeleteDocumentItem documentId={document.id} />
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {editing ? <EditDocumentDialog document={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function DeleteDocumentItem({ documentId }: { documentId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { run } = useServerAction();
  return (
    <ConfirmDialog
      trigger={
        <DropdownMenuItem variant="destructive" onSelect={(event) => event.preventDefault()}>
          <Trash2 aria-hidden />
          {t.common.delete}
        </DropdownMenuItem>
      }
      title={t.documents.deleteTitle}
      description={t.documents.deleteDescription}
      confirmLabel={t.common.delete}
      onConfirm={async () => {
        const result = await run(() => deleteDocumentAction(documentId), { success: t.documents.deleted });
        if (result?.ok) router.refresh();
        return !!result?.ok;
      }}
    />
  );
}

function EditDocumentDialog({ document, onClose }: { document: DocumentItem; onClose: () => void }) {
  const { t, message } = useI18n();
  const { pending, run } = useServerAction();
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const result = await run(() => updateDocumentAction(document.id, { title, description }), {
      success: t.documents.updated,
      silent: true,
    });
    if (result?.ok) onClose();
    else if (result)
      setError(result.error.fieldErrors?.title ? message(result.error.fieldErrors.title) : result.error.message);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.documents.editTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-document-title">{t.documents.fields.title}</Label>
            <Input
              id="edit-document-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-document-description">{t.documents.fields.description}</Label>
            <Textarea
              id="edit-document-description"
              rows={3}
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t.common.saveChanges}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
