import { z } from "zod";

export const taskDeliverableSchema = z.object({
  name: z.string().trim().min(2, "validation.required").max(200, "validation.tooLong"),
  description: z.string().trim().max(5000, "validation.tooLong").default(""),
  required: z.boolean().default(true),
  type: z.enum(["document", "dataset", "report", "code", "other"]).default("document"),
});
