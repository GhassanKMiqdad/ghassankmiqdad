"use client";

import { useState } from "react";
import { toast } from "sonner";

import { getDocumentUrlAction } from "@/server/actions/documents";

/**
 * Opens a stored file through a short-lived signed URL issued for the current
 * user (the server and the storage policy both check access on every call).
 */
export function useOpenDocument() {
  const [opening, setOpening] = useState<string | null>(null);

  const open = async (documentId: string, mode: "view" | "download") => {
    // Open the tab synchronously (popup blockers), then point it at the signed URL.
    const tab = mode === "view" ? window.open("about:blank", "_blank") : null;
    setOpening(documentId);
    const result = await getDocumentUrlAction(documentId, mode);
    setOpening(null);
    if (!result.ok) {
      tab?.close();
      toast.error(result.error.message);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.data.url;
    } else {
      const anchor = window.document.createElement("a");
      anchor.href = result.data.url;
      anchor.rel = "noopener";
      anchor.click();
    }
  };

  return { open, opening };
}
