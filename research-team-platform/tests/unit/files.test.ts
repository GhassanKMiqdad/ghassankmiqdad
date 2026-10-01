import { describe, expect, it } from "vitest";

import { documentStoragePath, fileKind, isDocumentPathFor, resolveFileType, sanitizeFileName } from "@/lib/files";
import { formatBytes } from "@/lib/utils";

const PROJECT = "20000000-0000-4000-8000-00000000000a";
const DOCUMENT = "40000000-0000-4000-8000-000000000001";

describe("file helpers", () => {
  it("allows research document types and rejects executable / active content", () => {
    expect(resolveFileType("paper.PDF")).toEqual({ extension: "pdf", mimeType: "application/pdf" });
    expect(resolveFileType("results.xlsx")?.mimeType).toContain("spreadsheetml");
    expect(resolveFileType("refs.bib")?.mimeType).toBe("application/x-bibtex");
    for (const name of ["index.html", "image.svg", "script.js", "setup.exe", "macro.docm", "noextension"]) {
      expect(resolveFileType(name), name).toBeNull();
    }
  });

  it("produces storage-safe object names (original name is kept in the database)", () => {
    expect(sanitizeFileName("مراجعة الأدبيات.pdf")).toBe("document.pdf");
    expect(sanitizeFileName("Survey Results (v2).csv")).toBe("Survey-Results-v2.csv");
    expect(sanitizeFileName("../../etc/passwd.txt")).toBe("etc-passwd.txt");
  });

  it("builds and validates the <project>/<document>/<file> layout used by storage policies", () => {
    const storagePath = documentStoragePath(PROJECT, DOCUMENT, "paper.pdf");
    expect(storagePath).toBe(`${PROJECT}/${DOCUMENT}/paper.pdf`);
    expect(isDocumentPathFor(PROJECT, DOCUMENT, storagePath)).toBe(true);
    expect(isDocumentPathFor(PROJECT, DOCUMENT, `${PROJECT}/${DOCUMENT}/nested/paper.pdf`)).toBe(false);
    expect(isDocumentPathFor(PROJECT, DOCUMENT, `other/${DOCUMENT}/paper.pdf`)).toBe(false);
  });

  it("classifies files for icons", () => {
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind("text/csv")).toBe("sheet");
    expect(fileKind("image/png")).toBe("image");
  });

  it("formats file sizes with locale-appropriate units", () => {
    expect(formatBytes(104, "en")).toBe("104 B");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024, "en")).toBe("50 MB");
    expect(formatBytes(104, "ar")).toBe("104 بايت");
    expect(formatBytes(1536, "ar")).toContain("1.5");
    expect(formatBytes(-1, "en")).toBe("—");
  });
});
