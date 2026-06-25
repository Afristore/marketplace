"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            fontFamily: "sans-serif",
          }}
        >
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
            Something went wrong
          </h2>
          <p style={{ color: "#666", marginBottom: "1.5rem" }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1.25rem",
              background: "#111",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
