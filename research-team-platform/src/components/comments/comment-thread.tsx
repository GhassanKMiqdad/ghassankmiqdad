"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MessageSquare, Pencil, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RelativeTime } from "@/components/shared/date-text";
import { useServerAction } from "@/components/shared/use-action";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { canDeleteComment, canEditComment } from "@/lib/permissions/policy";
import { commentSchema, type CommentInput } from "@/lib/validation/comment";
import { addCommentAction, deleteCommentAction, updateCommentAction } from "@/server/actions/comments";
import { fromAccessDTO, type ProjectAccessDTO } from "@/lib/permissions/access";
import type { CommentItem } from "@/types/app";

export function CommentThread({
  projectId,
  taskId,
  comments,
  access,
}: {
  projectId: string;
  taskId: string | null;
  comments: CommentItem[];
  access: ProjectAccessDTO;
}) {
  const { t } = useI18n();
  const subject = fromAccessDTO(access);
  const canComment = subject.permissions.has("comments.create") && subject.status === "active";

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <MessageSquare className="size-5" aria-hidden />
          {t.comments.empty}
        </div>
      ) : (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              canEdit={canEditComment(subject, comment.authorId)}
              canDelete={canDeleteComment(subject, comment.authorId)}
            />
          ))}
        </ul>
      )}
      {canComment ? (
        <CommentComposer projectId={projectId} taskId={taskId} />
      ) : (
        <p className="text-xs text-muted-foreground">{t.comments.cannotComment}</p>
      )}
    </div>
  );
}

function CommentComposer({ projectId, taskId }: { projectId: string; taskId: string | null }) {
  const { t, message } = useI18n();
  const { pending, run } = useServerAction();
  const form = useForm<CommentInput>({ resolver: zodResolver(commentSchema), defaultValues: { content: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await run(() => addCommentAction(projectId, taskId, values), { success: t.comments.added });
    if (result?.ok) form.reset();
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-2" noValidate>
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder={t.comments.placeholder}
                  aria-label={t.comments.placeholder}
                  {...field}
                />
              </FormControl>
              <FormMessage localize={message} />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t.comments.submit}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function CommentRow({ comment, canEdit, canDelete }: { comment: CommentItem; canEdit: boolean; canDelete: boolean }) {
  const { t, message } = useI18n();
  const [editing, setEditing] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<CommentInput>({
    resolver: zodResolver(commentSchema),
    defaultValues: { content: comment.content },
  });
  const authorName = comment.author?.name ?? t.common.unknownUser;

  const onSave = form.handleSubmit(async (values) => {
    const result = await run(() => updateCommentAction(comment.id, values), { success: t.comments.updated });
    if (result?.ok) setEditing(false);
  });

  return (
    <li className="flex gap-3">
      <UserAvatar name={authorName} seed={comment.authorId ?? comment.id} className="mt-0.5" />
      <div className="min-w-0 flex-1 rounded-lg border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{authorName}</span>
          <RelativeTime value={comment.createdAt} className="text-xs text-muted-foreground" />
          {comment.edited ? <span className="text-xs text-muted-foreground">({t.comments.edited})</span> : null}
          <div className="ms-auto flex gap-1">
            {canEdit && !editing ? (
              <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label={t.comments.editLabel}>
                <Pencil aria-hidden />
              </Button>
            ) : null}
            {canDelete ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label={t.comments.deleteLabel}>
                    <Trash2 aria-hidden />
                  </Button>
                }
                title={t.comments.deleteTitle}
                confirmLabel={t.common.delete}
                onConfirm={async () => {
                  const result = await run(() => deleteCommentAction(comment.id), { success: t.comments.deleted });
                  return !!result?.ok;
                }}
              />
            ) : null}
          </div>
        </div>
        {editing ? (
          <Form {...form}>
            <form onSubmit={onSave} className="mt-2 space-y-2" noValidate>
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea rows={3} aria-label={t.comments.editLabel} {...field} />
                    </FormControl>
                    <FormMessage localize={message} />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
                  {t.common.cancel}
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {t.common.save}
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <p dir="auto" className="mt-1 text-start text-sm leading-relaxed break-words whitespace-pre-wrap">
            {comment.content}
          </p>
        )}
      </div>
    </li>
  );
}
