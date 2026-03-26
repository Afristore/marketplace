// ─────────────────────────────────────────────────────────────
// components/Navbar.tsx — Afristore Navigation (Redesigned)
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useWalletContext } from "@/context/WalletContext";
import { Wallet, Store, LayoutDashboard, Menu, X, AlertTriangle, LogOut, ShieldCheck, Tag, Inbox, Compass, User, Gavel } from "lucide-react";
import { ConnectWalletModal } from "./ConnectWalletModal";

export function Navbar() {
  const { publicKey, isConnected, isConnecting, disconnect, isWrongNetwork, status } =
    useWalletContext();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const shortKey = publicKey
    ? `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`
    : null;

  // Detect scroll for transparent → solid transition
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled
          ? "bg-midnight-900/95 backdrop-blur-xl border-b border-white/5 shadow-lg shadow-black/20"
          : "bg-transparent"
          }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-4">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2.5 group"
          >
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-500 text-white text-xl shadow-lg shadow-brand-500/30 group-hover:shadow-brand-500/50 transition-all duration-300 group-hover:rotate-6">
              🎨
            </span>
            <span className="text-xl font-display font-bold text-white tracking-tight">
              Afri<span className="text-brand-400">store</span>
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-white/70 hover:text-brand-400 transition-colors duration-300"
            >
              <Store size={16} />
              Marketplace
            </Link>
            <Link
              href="/explore"
              className="flex items-center gap-1.5 text-white/70 hover:text-brand-400 transition-colors duration-300"
            >
              <Compass size={16} />
              Explore
            </Link>
            <Link
              href="/auctions"
              className="flex items-center gap-1.5 text-white/70 hover:text-brand-400 transition-colors duration-300"
            >
              <Gavel size={16} />
              Auctions
            </Link>
            {isConnected && (
              <>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-1.5 text-white/70 hover:text-brand-400 transition-colors duration-300"
                >
                  <LayoutDashboard size={16} />
                  Dashboard
                </Link>
                <Link
                  href="/profile"
                  className="flex items-center gap-1.5 text-white/70 hover:text-mint-400 transition-colors duration-300"
                >
                  <User size={16} />
                  My Profile
                </Link>
              </>
            )}
            {isConnected && (
              <Link
                href="/offers"
                className="flex items-center gap-1.5 text-white/70 hover:text-brand-400 transition-colors duration-300"
              >
                <Tag size={16} />
                My Offers
              </Link>
            )}
            {isConnected && (
              <Link
                href="/offers/incoming"
                className="flex items-center gap-1.5 text-white/70 hover:text-brand-400 transition-colors duration-300"
              >
                <Inbox size={16} />
                Offer Inbox
              </Link>
            )}
          </div>


          {/* Desktop wallet button */}
          <div className="hidden md:flex items-center gap-4">
            {isConnected ? (
              <div className="flex items-center gap-3">
                {isWrongNetwork ? (
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="flex items-center gap-2 rounded-full bg-terracotta-500/20 border border-terracotta-500/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-terracotta-400 hover:bg-terracotta-500/30 transition-all"
                  >
                    <AlertTriangle size={12} />
                    Wrong Network
                  </button>
                ) : (
                  <div className="flex items-center gap-2 rounded-full bg-mint-500/10 border border-mint-500/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-mint-400">
                    <ShieldCheck size={12} />
                    Connected
                  </div>
                )}

                <div className="relative group">
                  <div className="flex items-center gap-2 pl-3 pr-1 py-1 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer">
                    <span className="text-xs font-mono text-white/90">{shortKey}</span>
                    <button
                      onClick={disconnect}
                      title="Disconnect Wallet"
                      className="p-1.5 rounded-lg text-white/40 hover:text-terracotta-400 transition-colors"
                    >
                      <LogOut size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsModalOpen(true)}
                disabled={isConnecting}
                className="flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-terracotta-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-500/25 hover:shadow-brand-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300"
              >
                <Wallet size={16} />
                {isConnecting ? "Connecting…" : "Connect Wallet"}
              </button>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 text-white/70 hover:bg-white/10 border border-white/10 transition-all"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile drawer */}
        <div
          className={`md:hidden overflow-hidden transition-all duration-500 ${mobileOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
            }`}
        >
          <div className="bg-midnight-950/98 backdrop-blur-xl border-t border-white/5 px-4 py-8 space-y-6">
            <div className="grid grid-cols-1 gap-4">
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
              >
                <Store size={20} className="text-brand-500" />
                Marketplace
              </Link>
              <Link
                href="/explore"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
              >
                <Compass size={20} className="text-brand-500" />
                Explore
              </Link>
              <Link
                href="/auctions"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
              >
                <Gavel size={20} className="text-brand-500" />
                Auctions
              </Link>
              {isConnected && (
                <>
                  <Link
                    href="/dashboard"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
                  >
                    <LayoutDashboard size={20} className="text-brand-500" />
                    Dashboard
                  </Link>
                  <Link
                    href="/profile"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 text-white/80 hover:text-mint-400 transition-colors text-lg font-display"
                  >
                    <User size={20} className="text-mint-400" />
                    My Profile
                  </Link>
                </>
              )}
              {isConnected && (
                <Link
                  href="/offers"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
                >
                  <Tag size={20} className="text-brand-500" />
                  My Offers
                </Link>
              )}
              {isConnected && (
                <Link
                  href="/offers/incoming"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
                >
                  <Inbox size={20} className="text-brand-500" />
                  Offer Inbox
                </Link>
              )}
            </div>

            <div className="pt-6 border-t border-white/5">
              {isConnected ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-mono text-brand-300">{shortKey}</p>
                    {isWrongNetwork && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-terracotta-400 uppercase">
                        <AlertTriangle size={12} /> Network Error
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      disconnect();
                      setMobileOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-terracotta-500/30 bg-terracotta-500/10 py-3.5 text-sm font-bold text-terracotta-400 hover:bg-terracotta-500/20 transition-all"
                  >
                    <LogOut size={16} />
                    Disconnect Wallet
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setIsModalOpen(true);
                    setMobileOpen(false);
                  }}
                  disabled={isConnecting}
                  className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-brand-500 py-4 text-base font-bold text-white shadow-xl shadow-brand-500/20"
                >
                  <Wallet size={20} />
                  {isConnecting ? "Connecting…" : "Connect Wallet"}
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      <ConnectWalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}

