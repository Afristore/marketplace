// ─────────────────────────────────────────────────────────────
// hooks/useSafeToast.ts — Toast accessor that never throws
// ─────────────────────────────────────────────────────────────
//
// `useToast` intentionally throws when it is used outside of a
// `ToastProvider`. That is the right behaviour for components, but it
// is too strict for mutation hooks: a hook that renders without the
// provider mounted (unit tests, isolated widgets, previews) would
// crash the whole React tree.
//
// `useSafeToast` mirrors the defensive pattern the lending mutation
// hooks already use: it calls `useToast` inside a try/catch and
// degrades to a no-op when no provider is available, so a missing
// provider can never take the application down.
// ─────────────────────────────────────────────────────────────

"use client";

import { useToast, type ToastType } from "@/components/ToastProvider";

export type { ToastType };

export type PushToast = (
  message: string,
  type?: ToastType,
  durationMs?: number,
) => void;

const noop: PushToast = () => {};

/**
 * Returns a `pushToast` function that is always safe to call.
 *
 * When a `ToastProvider` is mounted the real toast is used; when it is
 * not, the returned function silently does nothing instead of throwing
 * and unmounting the tree.
 */
export function useSafeToast(): PushToast {
  let pushToast: PushToast | null = null;
  try {
    const toastContext = useToast();
    pushToast = toastContext.pushToast as PushToast;
  } catch {
    // No ToastProvider mounted — fall back to the no-op.
    pushToast = null;
  }
  return pushToast ?? noop;
}
