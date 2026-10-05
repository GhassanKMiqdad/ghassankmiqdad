import { z } from "zod";

import { uuidField } from "@/lib/validation/common";

export const createSubmissionSchema = z
  .object({
    notes: z.string().trim().max(10000, "validation.tooLong").default(""),
    documentIds: z.array(uuidField).max(10, "validation.tooLong").default([]),
    attachments: z
      .array(z.object({ documentId: uuidField, deliverableId: uuidField }))
      .max(10, "validation.tooLong")
      .default([]),
  })
  .superRefine((value, context) => {
    const ids = value.attachments.length
      ? value.attachments.map((attachment) => attachment.documentId)
      : value.documentIds;
    if (value.documentIds.length && value.attachments.length) {
      context.addIssue({ code: "custom", message: "validation.invalid", path: ["attachments"] });
    }
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "validation.invalid", path: ["attachments"] });
    }
    if (value.notes.length === 0 && ids.length === 0) {
      context.addIssue({ code: "custom", message: "validation.required", path: ["notes"] });
    }
  });

export const reviewSubmissionSchema = z
  .object({
    submissionId: uuidField,
    decision: z.enum(["approved", "revision_required", "rejected"]),
    feedback: z.string().trim().max(10000, "validation.tooLong").default(""),
  })
  .refine((value) => value.decision === "approved" || value.feedback.trim().length >= 3, {
    message: "validation.required",
    path: ["feedback"],
  });
