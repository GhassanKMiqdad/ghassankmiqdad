import { z } from "zod";

export const commentSchema = z.object({
  content: z.string().trim().min(1, "validation.required").max(5000, "validation.tooLong"),
});

export type CommentInput = z.input<typeof commentSchema>;
