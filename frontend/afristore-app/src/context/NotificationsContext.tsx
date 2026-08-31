// ─────────────────────────────────────────────────────────────
// context/NotificationsContext.tsx — Real-time notifications via SSE
// ─────────────────────────────────────────────────────────────

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import {
  createWalletSSEConnection,
  WalletEvent,
  getWalletPreferences,
} from "@/lib/indexer";

const SETTINGS_KEY = "afristore_settings";

interface SettingsState {
  priceAlerts: boolean;
  offerUpdates: boolean;
  auctionEndings: boolean;
}

const defaultSettings: SettingsState = {
  priceAlerts: true,
  offerUpdates: true,
  auctionEndings: true,
};

function loadSettings(): SettingsState {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored
      ? { ...defaultSettings, ...JSON.parse(stored) }
      : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

// ─────────────────────────────────────────────────────────────
// Read-state persistence (per wallet) via localStorage
// ─────────────────────────────────────────────────────────────

const READ_IDS_KEY_PREFIX = "afristore_read_notifications:";

function getReadIds(publicKey: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(READ_IDS_KEY_PREFIX + publicKey);
    return stored ? new Set<string>(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveReadIds(publicKey: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      READ_IDS_KEY_PREFIX + publicKey,
      JSON.stringify([...ids]),
    );
  } catch {}
}

export interface NotificationsState {
  notifications: WalletEvent[];
  unreadCount: number;
  isConnected: boolean;
  error: string | null;
  addNotification: (event: WalletEvent) => void;
  markAsRead: (eventId: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
  removeNotification: (eventId: string) => void;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

interface NotificationsProviderProps {
  children: ReactNode;
  publicKey: string | null;
}

/**
 * Determines if an event type should be filtered based on user preferences.
 */
function shouldFilterEvent(
  event: WalletEvent,
  settings: SettingsState,
): boolean {
  switch (event.type) {
    case "PRICE_ALERT":
      return !settings.priceAlerts;
    case "OFFER_RECEIVED":
    case "OFFER_ACCEPTED":
    case "OFFER_REJECTED":
      return !settings.offerUpdates;
    case "AUCTION_ENDING":
    case "AUCTION_WON":
    case "AUCTION_OUTBID":
      return !settings.auctionEndings;
    default:
      // SALE, PURCHASE, ROYALTY are always shown
      return false;
  }
}

export function NotificationsProvider({
  children,
  publicKey,
}: NotificationsProviderProps) {
  const [notifications, setNotifications] = useState<WalletEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsState>(loadSettings);

  const sseConnectionRef = useRef<{ close: () => void } | null>(null);

  // Fetch initial notifications from API
  useEffect(() => {
    if (!publicKey) {
      setNotifications([]);
      return;
    }

    let cancelled = false;
    const fetchInitial = async () => {
      try {
        const res = await fetch(`/api/notifications?address=${publicKey}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        const list: WalletEvent[] = data.notifications || [];
        const readIds = getReadIds(publicKey);

        // Apply read status based on localStorage
        const processed = list.map((n) => ({
          ...n,
          read: n.read || readIds.has(n.id),
        }));

        setNotifications(processed);
      } catch (err) {
        console.error("Failed to load initial notifications:", err);
      }
    };

    fetchInitial();

    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  // Load preferences from indexer when wallet connects
  useEffect(() => {
    if (!publicKey) return;

    let cancelled = false;
    (async () => {
      try {
        const prefs = await getWalletPreferences(publicKey);
        if (cancelled) return;
        setSettings((prev) => ({
          ...prev,
          ...(typeof prefs.priceAlerts === "boolean"
            ? { priceAlerts: prefs.priceAlerts }
            : {}),
          ...(typeof prefs.offerUpdates === "boolean"
            ? { offerUpdates: prefs.offerUpdates }
            : {}),
          ...(typeof prefs.auctionEndings === "boolean"
            ? { auctionEndings: prefs.auctionEndings }
            : {}),
        }));
      } catch {
        // Keep local settings on error
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  // Listen for settings changes from the settings page
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SETTINGS_KEY && e.newValue) {
        try {
          const newSettings = JSON.parse(e.newValue);
          setSettings((prev) => ({
            ...prev,
            priceAlerts: newSettings.priceAlerts ?? prev.priceAlerts,
            offerUpdates: newSettings.offerUpdates ?? prev.offerUpdates,
            auctionEndings: newSettings.auctionEndings ?? prev.auctionEndings,
          }));
        } catch {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Establish SSE connection when wallet is connected
  useEffect(() => {
    // Close existing connection if wallet disconnected
    if (!publicKey) {
      if (sseConnectionRef.current) {
        sseConnectionRef.current.close();
        sseConnectionRef.current = null;
      }
      setIsConnected(false);
      setError(null);
      return;
    }

    // Don't reconnect if already connected
    if (sseConnectionRef.current) {
      return;
    }

    const handleEvent = (event: WalletEvent) => {
      // Filter events based on user preferences
      if (shouldFilterEvent(event, settings)) {
        console.info("[Notifications] Filtered event:", event.type);
        return;
      }

      setNotifications((prev) => {
        // Avoid duplicates
        if (prev.some((n) => n.id === event.id)) {
          return prev;
        }

        const readIds = getReadIds(publicKey);
        const processedEvent = {
          ...event,
          read: event.read || readIds.has(event.id),
        };

        // Keep only last 100 notifications
        const updated = [processedEvent, ...prev].slice(0, 100);
        return updated;
      });
    };

    const handleError = () => {
      setError("Connection to notification stream lost. Reconnecting...");
    };

    sseConnectionRef.current = createWalletSSEConnection(
      publicKey,
      handleEvent,
      handleError,
    );
    setIsConnected(true);
    setError(null);

    return () => {
      if (sseConnectionRef.current) {
        sseConnectionRef.current.close();
        sseConnectionRef.current = null;
      }
      setIsConnected(false);
    };
  }, [publicKey, settings]);

  // Reconnect when settings change
  useEffect(() => {
    // Only reconnect if we have an active connection
    if (!publicKey || !sseConnectionRef.current) return;

    // Close and reconnect to apply new filters
    sseConnectionRef.current.close();
    sseConnectionRef.current = null;

    const handleEvent = (event: WalletEvent) => {
      if (shouldFilterEvent(event, settings)) {
        return;
      }

      setNotifications((prev) => {
        if (prev.some((n) => n.id === event.id)) {
          return prev;
        }

        const readIds = getReadIds(publicKey);
        const processedEvent = {
          ...event,
          read: event.read || readIds.has(event.id),
        };

        const updated = [processedEvent, ...prev].slice(0, 100);
        return updated;
      });
    };

    const handleError = () => {
      setError("Connection to notification stream lost. Reconnecting...");
    };

    sseConnectionRef.current = createWalletSSEConnection(
      publicKey,
      handleEvent,
      handleError,
    );
  }, [settings, publicKey]);

  const addNotification = useCallback(
    (event: WalletEvent) => {
      if (shouldFilterEvent(event, settings)) {
        return;
      }

      setNotifications((prev) => {
        if (prev.some((n) => n.id === event.id)) {
          return prev;
        }

        const readIds = getReadIds(publicKey!);
        const processedEvent = {
          ...event,
          read: event.read || readIds.has(event.id),
        };

        const updated = [processedEvent, ...prev].slice(0, 100);
        return updated;
      });
    },
    [settings, publicKey],
  );

  const markAsRead = useCallback(
    (eventId: string) => {
      if (!publicKey) return;
      setNotifications((prev) => {
        const updated = prev.map((n) =>
          n.id === eventId ? { ...n, read: true } : n,
        );
        const readIds = getReadIds(publicKey);
        readIds.add(eventId);
        saveReadIds(publicKey, readIds);
        return updated;
      });
    },
    [publicKey],
  );

  const markAllAsRead = useCallback(async () => {
    if (!publicKey) return;

    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      const readIds = getReadIds(publicKey);
      prev.forEach((n) => readIds.add(n.id));
      saveReadIds(publicKey, readIds);
      return updated;
    });

    try {
      await fetch(`/api/notifications/read?address=${publicKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(
        "Failed to mark all notifications as read on backend:",
        err,
      );
    }
  }, [publicKey]);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const removeNotification = useCallback((eventId: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== eventId));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const value: NotificationsState = {
    notifications,
    unreadCount,
    isConnected,
    error,
    addNotification,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    removeNotification,
  };

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error(
      "useNotifications must be used inside <NotificationsProvider>",
    );
  }
  return ctx;
}
