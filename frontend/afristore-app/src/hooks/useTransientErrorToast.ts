// ─────────────────────────────────────────────────────────────
// hooks/useTransientErrorToast.ts — Error state → toast bridge
// ─────────────────────────────────────────────────────────────
//
// Every mutation hook keeps its failure message in a local `error`
// state; this hook mirrors that state into a transient error toast so
// the user is told what went wrong without the caller having to wire
// up a toast by hand.
//
// The toast accessor is the "safe" variant, so a missing
// `ToastProvider` (unit tests, isolated widgets) can never take the
// whole React tree down.
// ─────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef } from "react";
import { getReadableErrorMessage } from "@/lib/errors";
import { useSafeToast } from "./useSafeToast";

export function useTransientErrorToast(error: string | null) {
  const pushToast = useSafeToast();
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      lastErrorRef.current = null;
      return;
    }
    if (lastErrorRef.current === error) return;
    lastErrorRef.current = error;
    try {
      pushToast(getReadableErrorMessage(error), "error");
    } catch {
      // A broken toast provider must never break the mutation flow.
    }
  }, [error, pushToast]);
}
