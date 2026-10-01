"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary (replaces the root layout). Bilingual on purpose: the
 * i18n providers are not available here. No technical details are shown.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>حدث خطأ غير متوقع</h1>
          <p style={{ color: "#666", marginBottom: 4 }}>Something went wrong. The problem has been logged.</p>
          {error.digest ? <p style={{ color: "#999", fontSize: 12 }}>ref: {error.digest}</p> : null}
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}
          >
            إعادة المحاولة · Try again
          </button>
        </div>
      </body>
    </html>
  );
}
