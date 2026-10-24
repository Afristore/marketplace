/**
 * Unit tests for useWallet.ts (Freighter adapter).
 * Tests the hook via useFreighterWallet since that is what useWallet
 * delegates to in non-e2e mode.
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockIsFreighterInstalled = jest.fn();
const mockGetConnectedPublicKey = jest.fn();
const mockConnectFreighter = jest.fn();

jest.mock("@/lib/freighter", () => ({
  isFreighterInstalled: (...args: unknown[]) =>
    mockIsFreighterInstalled(...args),
  getConnectedPublicKey: (...args: unknown[]) =>
    mockGetConnectedPublicKey(...args),
  connectFreighter: (...args: unknown[]) => mockConnectFreighter(...args),
}));

jest.mock("@/lib/config", () => ({
  config: {
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "testnet",
  },
}));

jest.mock("@/providers/PostHogProvider", () => ({
  trackEvent: {
    walletConnected: jest.fn(),
    walletConnectionDropOff: jest.fn(),
  },
}));

// Force e2e mock chain to be off so useWallet delegates to Freighter
jest.mock("@/lib/e2e-chain-mock", () => ({
  isE2eMockChain: () => false,
}));

jest.mock("@/hooks/useE2eWallet", () => ({
  useE2eWallet: () => ({
    publicKey: null,
    networkPassphrase: null,
    status: "DISCONNECTED",
    isInstalled: false,
    isConnecting: false,
    isConnected: false,
    isWrongNetwork: false,
    error: null,
    connect: jest.fn(),
    disconnect: jest.fn(),
    refresh: jest.fn(),
  }),
}));

import { useWallet } from "@/hooks/useWallet";

// ── Helpers ───────────────────────────────────────────────────────────────────

function WalletComp() {
  const {
    status,
    publicKey,
    isConnected,
    isInstalled,
    error,
    connect,
    disconnect,
    refresh,
  } = useWallet();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="key">{publicKey ?? "null"}</span>
      <span data-testid="connected">{String(isConnected)}</span>
      <span data-testid="installed">{String(isInstalled)}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <button data-testid="connect" onClick={connect}>
        connect
      </button>
      <button data-testid="disconnect" onClick={disconnect}>
        disconnect
      </button>
      <button data-testid="refresh" onClick={refresh}>
        refresh
      </button>
    </div>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useWallet (Freighter)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows NOT_INSTALLED when Freighter is absent", async () => {
    mockIsFreighterInstalled.mockResolvedValue(false);
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("NOT_INSTALLED"),
    );
    expect(screen.getByTestId("installed").textContent).toBe("false");
  });

  it("auto-detects existing connection on mount", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue("GEXISTING");
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("key").textContent).toBe("GEXISTING"),
    );
  });

  it("shows DISCONNECTED when Freighter installed but not connected", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue(null);
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED"),
    );
    expect(screen.getByTestId("connected").textContent).toBe("false");
  });

  it("connect sets publicKey and shows CONNECTED on success", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue(null);
    mockConnectFreighter.mockResolvedValue({
      publicKey: "GNEWKEY",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED"),
    );

    await user.click(screen.getByTestId("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("CONNECTED"),
    );
    expect(screen.getByTestId("key").textContent).toBe("GNEWKEY");
  });

  it("connect sets error on wrong network", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue(null);
    mockConnectFreighter.mockResolvedValue({
      publicKey: "GWRONGNET",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED"),
    );

    await user.click(screen.getByTestId("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).not.toBe("none"),
    );
    expect(screen.getByTestId("status").textContent).toBe("WRONG_NETWORK");
  });

  it("connect sets error when user denies", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue(null);
    mockConnectFreighter.mockRejectedValue(new Error("User denied"));

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED"),
    );

    await user.click(screen.getByTestId("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).not.toBe("none"),
    );
  });

  it("disconnect clears publicKey", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue("GEXISTING");

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("key").textContent).toBe("GEXISTING"),
    );

    await user.click(screen.getByTestId("disconnect"));
    await waitFor(() =>
      expect(screen.getByTestId("key").textContent).toBe("null"),
    );
  });
});

describe("useWallet (Freighter) — async error handling", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it("treats a rejected install check as NOT_INSTALLED instead of crashing", async () => {
    mockIsFreighterInstalled.mockRejectedValue(new Error("extension crashed"));
    render(<WalletComp />);

    // Run the mount refresh plus every polling tick.
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.getByTestId("status").textContent).toBe("NOT_INSTALLED");
    expect(screen.getByTestId("installed").textContent).toBe("false");
    expect(mockGetConnectedPublicKey).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Wallet detection error:",
      expect.any(Error),
    );
  });

  it("recovers on the next poll after a transient install-check failure", async () => {
    mockIsFreighterInstalled
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue("GLATE");
    render(<WalletComp />);

    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    await waitFor(() =>
      expect(screen.getByTestId("key").textContent).toBe("GLATE"),
    );
    expect(screen.getByTestId("status").textContent).toBe("CONNECTED");
  });

  it("stays DISCONNECTED when auto-detecting the public key rejects", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockRejectedValue(new Error("locked"));
    render(<WalletComp />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED"),
    );
    expect(screen.getByTestId("key").textContent).toBe("null");
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("manual refresh does not reject when the install check fails", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue(null);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED"),
    );

    mockIsFreighterInstalled.mockRejectedValue(new Error("gone"));
    await user.click(screen.getByTestId("refresh"));

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("NOT_INSTALLED"),
    );
  });

  it("shows the friendly rejection message when the user denies access", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue(null);
    mockConnectFreighter.mockRejectedValue(
      new Error("Freighter access was denied by the user."),
    );
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED"),
    );

    await user.click(screen.getByTestId("connect"));

    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe(
        "Connection request was rejected.",
      ),
    );
    expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED");
  });

  it("falls back to a generic message for non-Error rejections and resets CONNECTING", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue(null);
    mockConnectFreighter.mockRejectedValue("bridge exploded");
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED"),
    );

    await user.click(screen.getByTestId("connect"));

    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe(
        "Failed to connect wallet",
      ),
    );
    expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED");
  });

  it("clears a previous connect error on a successful retry", async () => {
    mockIsFreighterInstalled.mockResolvedValue(true);
    mockGetConnectedPublicKey.mockResolvedValue(null);
    mockConnectFreighter
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        publicKey: "GRETRY",
        networkPassphrase: "Test SDF Network ; September 2015",
      });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<WalletComp />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED"),
    );

    await user.click(screen.getByTestId("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe("timeout"),
    );

    await user.click(screen.getByTestId("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("CONNECTED"),
    );
    expect(screen.getByTestId("error").textContent).toBe("none");
  });
});
