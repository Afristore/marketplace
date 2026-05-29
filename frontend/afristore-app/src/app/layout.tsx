// ─────────────────────────────────────────────────────────────
// app/layout.tsx — Root layout
// ─────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";
import { Navbar } from "@/components/Navbar";
import { RootErrorBoundary } from "@/components/RootErrorBoundary";
import { ToastProvider } from "@/components/ToastProvider";
import { CSPostHogProvider } from "@/providers/PostHogProvider";

export const metadata: Metadata = {
  title: "Afristore — African Art on Stellar",
  description:
    "Decentralized marketplace for African art. Buy and sell unique artworks using Stellar blockchain.",
  openGraph: {
    title: "Afristore",
    description: "Decentralized marketplace for African art on Stellar",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-brand-50 text-gray-900">
        <WalletProvider>
          <CSPostHogProvider>
            <ToastProvider>
              <RootErrorBoundary>
                <Navbar />
                <main className="w-full">{children}</main>
                <footer className="bg-midnight-950 border-t border-white/5 py-10 text-center text-sm text-white/30">
                  <div className="mx-auto max-w-7xl px-4 sm:px-6">
                    <p className="font-display text-lg font-bold text-white/50 mb-3">
                      🎨 Afri<span className="text-brand-400/60">store</span>
                    </p>
                    <p>
                      © {new Date().getFullYear()} Afristore · Built on{" "}
                      <a
                        href="https://stellar.org"
                        className="text-brand-400/70 hover:text-brand-400 hover:underline transition-colors"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Stellar
                      </a>
                      {" "}·{" "}
                      <a
                        href="https://freighter.app"
                        className="text-brand-400/70 hover:text-brand-400 hover:underline transition-colors"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Freighter Wallet
                      </a>
                      {" "}·{" "}
                      <a
                        href="/settings"
                        className="text-brand-400/70 hover:text-brand-400 hover:underline transition-colors"
                      >
                        Settings
                      </a>
                      {" "}·{" "}
                      <a
                        href="/help"
                        className="text-brand-400/70 hover:text-brand-400 hover:underline transition-colors"
                      >
                        Help
                      </a>
                    </p>
                    <p className="mt-3 text-xs text-white/15">
                      Celebrating African art and heritage through blockchain technology.
                    </p>
                  </div>
                </footer>
              </RootErrorBoundary>
            </ToastProvider>
          </CSPostHogProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
