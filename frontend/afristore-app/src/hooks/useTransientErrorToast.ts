"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ToastProvider";
import { getReadableErrorMessage } from "@/lib/errors";

export function useTransientErrorToast(error: string | null) {
  const { pushToast } = useToast();
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      lastErrorRef.current = null;
      return;
    }
    if (lastErrorRef.current === error) return;
    lastErrorRef.current = error;
    pushToast(getReadableErrorMessage(error), "error");
  }, [error, pushToast]);
}
