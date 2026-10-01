/**
 * Allowed document types, keyed by extension. The MIME type sent to Storage is
 * derived from the extension on the server (never trusted from the browser)
 * and must also be listed in the bucket's allowed_mime_types.
 */
export const ALLOWED_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  tex: "application/x-tex",
  bib: "application/x-bibtex",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(",");

export function fileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

export function resolveFileType(fileName: string): { extension: string; mimeType: string } | null {
  const extension = fileExtension(fileName);
  const mimeType = ALLOWED_FILE_TYPES[extension];
  return mimeType ? { extension, mimeType } : null;
}

/**
 * Storage-safe object name: ASCII letters, digits, dot, dash and underscore.
 * The original (possibly Arabic) name is kept in documents.file_name.
 */
export function sanitizeFileName(fileName: string): string {
  const extension = fileExtension(fileName);
  const base = fileName
    .trim()
    .replace(/\.[A-Za-z0-9]{1,10}$/, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  const safeBase = base || "document";
  return extension ? `${safeBase}.${extension}` : safeBase;
}

/** Storage path layout shared with the RLS policies: <project>/<document>/<file>. */
export function documentStoragePath(projectId: string, documentId: string, fileName: string): string {
  return `${projectId}/${documentId}/${sanitizeFileName(fileName)}`;
}

export function isDocumentPathFor(projectId: string, documentId: string, storagePath: string): boolean {
  const prefix = `${projectId}/${documentId}/`;
  return storagePath.startsWith(prefix) && !storagePath.slice(prefix.length).includes("/");
}

export type FileKind = "pdf" | "sheet" | "image" | "archive" | "code" | "text";

export function fileKind(mimeType: string): FileKind {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") return "sheet";
  if (mimeType.includes("zip")) return "archive";
  if (mimeType === "application/json" || mimeType.includes("tex") || mimeType.includes("bibtex")) return "code";
  return "text";
}
