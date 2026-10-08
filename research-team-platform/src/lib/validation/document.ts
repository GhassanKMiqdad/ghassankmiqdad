import { z } from "zod";

import { MAX_UPLOAD_BYTES } from "@/lib/env";
import { optionalUuidField, uuidField } from "@/lib/validation/common";

export const documentDetailsSchema = z.object({
  title: z.string().trim().min(1, "validation.required").max(200, "validation.tooLong"),
  description: z.string().trim().max(2000, "validation.tooLong"),
});

export const prepareUploadSchema = z.object({
  projectId: uuidField,
  /** Set for a private task file; omitted for the project library. */
  taskId: optionalUuidField,
  fileName: z.string().trim().min(1, "validation.fileRequired").max(255, "validation.tooLong"),
  size: z.number().int().positive("validation.fileRequired").max(MAX_UPLOAD_BYTES, "validation.tooLong"),
});

export const finalizeUploadSchema = z.object({
  projectId: uuidField,
  taskId: optionalUuidField,
  documentId: uuidField,
  storagePath: z.string().min(1).max(512),
  fileName: z.string().trim().min(1).max(255),
  title: documentDetailsSchema.shape.title,
  description: documentDetailsSchema.shape.description,
});

export type DocumentDetailsInput = z.input<typeof documentDetailsSchema>;
