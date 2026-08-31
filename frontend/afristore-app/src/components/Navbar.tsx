// ─────────────────────────────────────────────────────────────
// components/Navbar.tsx — Afristore Navigation (Redesigned)
// ─────────────────────────────────────────────────────────────
"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useWalletContext } from "@/context/WalletContext";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  Compass,
  Gavel,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Rocket,
  Settings,
  ShieldCheck,
  Split,
  Tag,
  User,
  Wallet,
  X,
} from "lucide-react";
import { ConnectWalletModal } from "./ConnectWalletModal";

const USER_MENU_ITEMS = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/splitter", icon: Split, label: "Splitter" },
  { href: "/profile", icon: User, label: "My Profile" },
  { href: "/offers", icon: Tag, label: "My Offers" },
  { href: "/offers/incoming", icon: Inbox, label: "Offer Inbox" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Navbar() {
  const {
    publicKey,
    isConnected,
    isConnecting,
    disconnect,
    isWrongNetwork,
    status,
    notifications: { notifications, unreadCount, markAllAsRead },
  } = useWalletContext();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);

  const shortKey = publicKey
    ? `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`
    : null;

  // Detect scroll for transparent → solid transition
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [userMenuOpen]);

  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    if (panelOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [panelOpen]);

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          scrolled
            ? "bg-midnight-900/95 backdrop-blur-xl border-b border-white/5 shadow-lg shadow-black/20"
            : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
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
            <Link
              href="/staking"
              className="flex items-center gap-1.5 text-white/70 hover:text-brand-400 transition-colors duration-300"
            >
              <Lock size={16} />
              Staking
            </Link>
            <Link
              href="/launchpad"
              className="flex items-center gap-1.5 text-white/70 hover:text-brand-400 transition-colors duration-300"
            >
              <Rocket size={16} />
              Launchpad
            </Link>
            <Link
              href="/help"
              className="flex items-center gap-1.5 text-white/70 hover:text-brand-400 transition-colors duration-300"
            >
              <HelpCircle size={16} />
              Help
            </Link>
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

                {/* Notification Bell */}
                <div className="relative" ref={panelRef}>
                  <button
                    data-testid="notification-bell"
                    aria-label="Notifications"
                    onClick={() => setPanelOpen((prev) => !prev)}
                    className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                  >
                    <Bell size={18} />
                    {unreadCount > 0 && (
                      <span
                        data-testid="notification-badge"
                        className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white ring-2 ring-midnight-950"
                      >
                        {unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Notification Dropdown Panel */}
                  {panelOpen && (
                    <div
                      data-testid="notifications-dropdown"
                      className="absolute right-0 mt-2 w-80 rounded-2xl bg-midnight-900/98 backdrop-blur-xl border border-white/10 shadow-xl shadow-black/40 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200"
                    >
                      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                        <span className="text-xs font-bold text-white">
                          Notifications
                        </span>
                        {unreadCount > 0 && (
                          <button
                            onClick={markAllAsRead}
                            className="text-[10px] font-bold text-brand-400 hover:text-brand-300 transition-colors uppercase tracking-wider"
                          >
                            Mark all as read
                          </button>
                        )}
                      </div>

                      <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
                        {notifications.length === 0 ? (
                          <div
                            data-testid="notification-empty"
                            className="flex flex-col items-center justify-center py-8 text-center px-4"
                          >
                            <span className="text-2xl mb-2">🔔</span>
                            <p className="text-xs text-white/40">
                              No notifications yet
                            </p>
                          </div>
                        ) : (
                          notifications.map((n) => (
                            <div
                              key={n.id}
                              data-testid="notification-item"
                              className={`p-4 transition-colors hover:bg-white/[0.02] ${
                                !n.read ? "bg-white/[0.01]" : ""
                              }`}
                            >
                              <Link
                                href={n.link || "#"}
                                onClick={() => setPanelOpen(false)}
                              >
                                <div className="flex items-start gap-3 flex-row">
                                  <div className="flex-1 min-w-0 text-left">
                                    <p
                                      className={`text-xs text-white truncate ${!n.read ? "font-bold" : "font-medium"}`}
                                    >
                                      {n.title}
                                    </p>
                                    <p className="text-[11px] text-white/50 mt-0.5 leading-normal whitespace-normal">
                                      {n.message}
                                    </p>
                                  </div>
                                  {!n.read && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0 mt-1.5" />
                                  )}
                                </div>
                              </Link>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen((prev) => !prev)}
                    className="flex items-center gap-2 pl-3 pr-2 py-1 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                    aria-haspopup="true"
                    aria-expanded={userMenuOpen}
                  >
                    <span className="text-xs font-mono text-white/90">
                      {shortKey}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-white/40 transition-transform duration-200 ${
                        userMenuOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {/* Dropdown panel */}
                  {userMenuOpen && (
                    <div className="absolute right-0 mt-2 w-52 rounded-xl bg-midnight-900/98 backdrop-blur-xl border border-white/10 shadow-xl shadow-black/40 overflow-hidden">
                      <div className="px-3 py-2.5 border-b border-white/5">
                        <p className="text-[10px] uppercase tracking-widest text-white/30 font-bold">
                          My Account
                        </p>
                        <p className="text-xs font-mono text-white/60 mt-0.5 truncate">
                          {publicKey}
                        </p>
                      </div>

                      <div className="py-1">
                        {USER_MENU_ITEMS.map(({ href, icon: Icon, label }) => (
                          <Link
                            key={href}
                            href={href}
                            onClick={() => setUserMenuOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                          >
                            <Icon
                              size={15}
                              className="text-brand-400 shrink-0"
                            />
                            {label}
                          </Link>
                        ))}
                      </div>

                      <div className="border-t border-white/5 py-1">
                        <button
                          onClick={() => {
                            disconnect();
                            setUserMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-terracotta-400 hover:bg-terracotta-500/10 transition-colors"
                        >
                          <LogOut size={15} className="shrink-0" />
                          Disconnect
                        </button>
                      </div>
                    </div>
                  )}
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

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 text-white/70 hover:bg-white/10 border border-white/10 transition-all"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile drawer */}
        <div
          className={`md:hidden overflow-hidden transition-all duration-500 ${
            mobileOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="bg-midnight-950/98 backdrop-blur-xl border-t border-white/5 px-4 py-8 space-y-6">
            <div className="grid grid-cols-1 gap-4">
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
              <Link
                href="/staking"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
              >
                <Lock size={20} className="text-brand-500" />
                Staking
              </Link>
              <Link
                href="/launchpad"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
              >
                <Rocket size={20} className="text-brand-500" />
                Launchpad
              </Link>
              <Link
                href="/help"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
              >
                <HelpCircle size={20} className="text-gray-400" />
                Help
              </Link>
            </div>

            {/* Post-login account section — only shown when connected */}
            {isConnected && (
              <div className="border-t border-white/10 pt-6 space-y-4">
                <p className="text-[10px] uppercase tracking-widest text-white/30 font-bold px-1">
                  My Account
                </p>
                <div className="grid grid-cols-1 gap-4">
                  {USER_MENU_ITEMS.map(({ href, icon: Icon, label }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 text-white/80 hover:text-brand-400 transition-colors text-lg font-display"
                    >
                      <Icon size={20} className="text-brand-500" />
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Wallet section */}
            <div className="border-t border-white/5 pt-6">
              {isConnected ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-mono text-brand-300">
                      {shortKey}
                    </p>
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

      <ConnectWalletModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
