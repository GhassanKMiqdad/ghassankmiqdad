"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_UPLOAD_BYTES } from "@/lib/env";
import { ACCEPT_ATTRIBUTE, resolveFileType } from "@/lib/files";
import { useI18n } from "@/lib/i18n/provider";
import { formatBytes } from "@/lib/utils";
import {
  discardDocumentUploadAction,
  finalizeDocumentUploadAction,
  prepareDocumentUploadAction,
} from "@/server/actions/documents";

type Phase = "idle" | "preparing" | "uploading" | "finalizing";

/**
 * Three-step upload: the server authorizes and issues a signed upload URL for a
 * server-chosen path, the browser sends the file straight to Storage, then the
 * server registers the document (the database verifies the object exists).
 */
export function UploadDocumentDialog({
  projectId,
  taskId,
  onUploaded,
}: {
  projectId: string;
  taskId?: string;
  onUploaded?: (documentId: string) => void;
}) {
  const { t, fmt, locale } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const busy = phase !== "idle";

  const reset = () => {
    setFile(null);
    setTitle("");
    setDescription("");
    setError(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const chooseFile = (selected: File | null) => {
    setError(null);
    setFile(selected);
    if (!selected) return;
    if (!resolveFileType(selected.name)) setError(t.errors.FILE_TYPE_NOT_ALLOWED);
    else if (selected.size > MAX_UPLOAD_BYTES) setError(fmt(t.errors.FILE_TOO_LARGE, { size: "50 MB" }));
    if (!title) setTitle(selected.name.replace(/\.[^.]+$/, "").slice(0, 200));
  };

  const upload = async () => {
    if (!file) {
      setError(t.validation.fileRequired);
      return;
    }
    if (!title.trim()) {
      setError(t.validation.required);
      return;
    }
    setError(null);

    setPhase("preparing");
    const prepared = await prepareDocumentUploadAction({ projectId, taskId, fileName: file.name, size: file.size });
    if (!prepared.ok) {
      setError(prepared.error.message);
      setPhase("idle");
      return;
    }

    setPhase("uploading");
    const { documentId, storagePath, signedUrl, signedFields } = prepared.data;
    const form = new FormData();
    for (const [key, value] of Object.entries(signedFields)) form.append(key, value);
    form.append("file", file);
    const uploadResponse = await fetch(signedUrl, {
      method: "POST",
      body: form,
    }).catch(() => null);
    if (!uploadResponse?.ok) {
      setError(t.errors.UPLOAD_FAILED);
      setPhase("idle");
      return;
    }

    setPhase("finalizing");
    const finalized = await finalizeDocumentUploadAction({
      projectId,
      taskId,
      documentId,
      storagePath,
      fileName: file.name,
      title: title.trim(),
      description: description.trim(),
    });
    if (!finalized.ok) {
      await discardDocumentUploadAction(projectId, storagePath, taskId);
      setError(finalized.error.message);
      setPhase("idle");
      return;
    }

    toast.success(t.documents.uploaded);
    onUploaded?.(finalized.data.documentId);
    setOpen(false);
    reset();
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Upload aria-hidden />
          {t.documents.upload}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.documents.uploadTitle}</DialogTitle>
          <DialogDescription>{fmt(t.documents.uploadDescription, { size: "50 MB" })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="document-file">{t.documents.file}</Label>
            <label
              htmlFor="document-file"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm hover:bg-muted/50"
            >
              <FileUp className="size-6 text-muted-foreground" aria-hidden />
              {file ? (
                <span className="max-w-full truncate font-medium">
                  {file.name} · {formatBytes(file.size, locale)}
                </span>
              ) : (
                <span className="text-muted-foreground">{t.documents.chooseFile}</span>
              )}
            </label>
            <input
              ref={inputRef}
              id="document-file"
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              disabled={busy}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="document-title">{t.documents.fields.title}</Label>
            <Input
              id="document-title"
              value={title}
              maxLength={200}
              disabled={busy}
              placeholder={t.documents.placeholders.title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="document-description">{t.documents.fields.description}</Label>
            <Textarea
              id="document-description"
              rows={3}
              value={description}
              maxLength={2000}
              disabled={busy}
              placeholder={t.documents.placeholders.description}
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
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button type="button" disabled={busy || !file || !!error} onClick={upload}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            {phase === "preparing"
              ? t.documents.preparing
              : phase === "uploading"
                ? t.documents.uploading
                : phase === "finalizing"
                  ? t.documents.finalizing
                  : t.documents.upload}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
