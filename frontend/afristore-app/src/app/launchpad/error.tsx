// ─────────────────────────────────────────────────────────────
// app/(launchpad)/launchpad/error.tsx — Launchpad Error Boundary
// ─────────────────────────────────────────────────────────────

"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function LaunchpadError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Launchpad Route Error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-midnight-950 text-white flex flex-col items-center justify-center p-4 text-center">
      <div className="w-20 h-20 bg-terracotta-500/10 rounded-full flex items-center justify-center mb-6 animate-pulse">
        <AlertCircle size={40} className="text-terracotta-500" />
      </div>
      
      <h2 className="text-3xl font-display font-bold mb-3">Something went wrong</h2>
      <p className="text-white/60 mb-10 max-w-md">
        We encountered an error while loading the Launchpad. This might be a temporary connection issue.
      </p>

      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={reset}
          className="px-8 py-3 rounded-xl bg-brand-500 text-white font-bold hover:bg-brand-600 transition-all flex items-center gap-2 shadow-lg shadow-brand-500/20"
        >
          <RefreshCw size={18} />
          Try Again
        </button>
        <Link
          href="/"
          className="px-8 py-3 rounded-xl bg-white/5 text-white font-bold hover:bg-white/10 transition-all border border-white/10 flex items-center gap-2"
        >
          <Home size={18} />
          Back to Home
        </Link>
      </div>
      
      {error.digest && (
        <p className="mt-8 text-[10px] font-mono text-white/20 uppercase tracking-widest">
          Error ID: {error.digest}
        </p>
      )}
    </div>
  );
}
