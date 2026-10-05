import { describe, expect, it } from "vitest";

import { createSubmissionSchema, reviewSubmissionSchema } from "@/lib/validation/submission";

const documentId = "00000000-0000-4000-8000-000000000001";
const submissionId = "00000000-0000-4000-8000-000000000002";

describe("submission/review validation", () => {
  it("defaults optional notes and requires a note or an attachment", () => {
    expect(createSubmissionSchema.parse({ documentIds: [documentId] })).toEqual({
      notes: "",
      documentIds: [documentId],
      attachments: [],
    });
    expect(createSubmissionSchema.safeParse({}).success).toBe(false);
  });

  it("rejects duplicate or excessive attachment IDs", () => {
    expect(createSubmissionSchema.safeParse({ documentIds: [documentId, documentId] }).success).toBe(false);
    expect(
      createSubmissionSchema.safeParse({
        documentIds: Array.from(
          { length: 11 },
          (_, index) => `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });

  it("requires meaningful feedback for revision and rejection decisions", () => {
    expect(
      reviewSubmissionSchema.safeParse({ submissionId, decision: "revision_required", feedback: "" }).success,
    ).toBe(false);
    expect(reviewSubmissionSchema.safeParse({ submissionId, decision: "rejected", feedback: "No" }).success).toBe(
      false,
    );
    expect(
      reviewSubmissionSchema.safeParse({
        submissionId,
        decision: "revision_required",
        feedback: "Add the missing methods section.",
      }).success,
    ).toBe(true);
  });

  it("allows an approval without mandatory feedback", () => {
    expect(reviewSubmissionSchema.safeParse({ submissionId, decision: "approved", feedback: "" }).success).toBe(true);
  });
});
