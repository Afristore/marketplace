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
      <body className="bg-midnight-950">
        <div className="flex flex-col items-center justify-center min-h-screen px-8 py-16">
          <div className="max-w-md text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-terracotta-500/20 flex items-center justify-center mx-auto mb-6 border border-terracotta-500/30">
              <span className="text-4xl">⚠️</span>
            </div>
            
            <h2 className="text-3xl font-display font-bold text-white">
              Something went wrong
            </h2>
            
            <p className="text-white/60 leading-relaxed">
              An unexpected error occurred. Our team has been notified and is working on a fix.
            </p>
            
            <button
              onClick={reset}
              className="px-8 py-4 rounded-xl bg-brand-500 text-white font-bold hover:bg-brand-600 transition-all shadow-lg shadow-brand-500/20 hover:shadow-brand-500/40 active:scale-95"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
