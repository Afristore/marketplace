/**
 * Unit tests for WalletContext.
 * Tests that WalletContext correctly updates the isConnecting state
 * during the Freighter connection lifecycle.
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

jest.mock("@/hooks/useMagicWallet", () => ({
  useMagicWallet: () => ({
    publicAddress: null,
    isConnected: false,
    isConnecting: false,
    status: "DISCONNECTED",
    error: null,
    logout: jest.fn(),
    loginWithEmail: jest.fn(),
    connect: jest.fn(),
    refresh: jest.fn(),
  }),
}));

import { WalletProvider, useWalletContext } from "@/context/WalletContext";

// ── Test Component ────────────────────────────────────────────────────────────

function WalletTestComponent() {
  const {
    status,
    publicKey,
    isConnected,
    isConnecting,
    isInstalled,
    error,
    connect,
    disconnect,
  } = useWalletContext();

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="key">{publicKey ?? "null"}</span>
      <span data-testid="connected">{String(isConnected)}</span>
      <span data-testid="connecting">{String(isConnecting)}</span>
      <span data-testid="installed">{String(isInstalled)}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <button data-testid="connect" onClick={connect}>
        connect
      </button>
      <button data-testid="disconnect" onClick={disconnect}>
        disconnect
      </button>
    </div>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WalletContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("isConnecting state during Freighter connection lifecycle", () => {
    it("isConnecting is false initially when disconnected", async () => {
      mockIsFreighterInstalled.mockResolvedValue(true);
      mockGetConnectedPublicKey.mockResolvedValue(null);

      render(
        <WalletProvider>
          <WalletTestComponent />
        </WalletProvider>,
      );

      // Wait for the component to finish checking if Freighter is installed
      await waitFor(() => {
        expect(screen.getByTestId("installed").textContent).toBe("true");
      });

      // Now check the status is DISCONNECTED (installed but not connected)
      await waitFor(() => {
        expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED");
      });
      expect(screen.getByTestId("connecting").textContent).toBe("false");
    });

    it("isConnecting is set to true when connection starts", async () => {
      mockIsFreighterInstalled.mockResolvedValue(true);
      mockGetConnectedPublicKey.mockResolvedValue(null);

      // Create a promise that we can resolve manually to simulate async connection
      let resolveConnect: (value: {
        publicKey: string;
        networkPassphrase: string;
      }) => void;
      const connectPromise = new Promise<{
        publicKey: string;
        networkPassphrase: string;
      }>((resolve) => {
        resolveConnect = resolve;
      });
      mockConnectFreighter.mockReturnValue(connectPromise);

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      render(
        <WalletProvider>
          <WalletTestComponent />
        </WalletProvider>,
      );

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED");
      });

      // Click connect - this should start the connection process
      await act(async () => {
        await user.click(screen.getByTestId("connect"));
      });

      // isConnecting should be true during the connection attempt
      await waitFor(() => {
        expect(screen.getByTestId("connecting").textContent).toBe("true");
      });
      expect(screen.getByTestId("status").textContent).toBe("CONNECTING");

      // Resolve the connection
      await act(async () => {
        resolveConnect!({
          publicKey: "GNEWKEY",
          networkPassphrase: "Test SDF Network ; September 2015",
        });
        await jest.runAllTimersAsync();
      });

      // isConnecting should be false after connection completes
      await waitFor(() => {
        expect(screen.getByTestId("connecting").textContent).toBe("false");
      });
      expect(screen.getByTestId("status").textContent).toBe("CONNECTED");
    });

    it("isConnecting transitions from true to false on successful connection", async () => {
      mockIsFreighterInstalled.mockResolvedValue(true);
      mockGetConnectedPublicKey.mockResolvedValue(null);
      mockConnectFreighter.mockResolvedValue({
        publicKey: "GNEWKEY",
        networkPassphrase: "Test SDF Network ; September 2015",
      });

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      render(
        <WalletProvider>
          <WalletTestComponent />
        </WalletProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED");
      });

      // Initially not connecting
      expect(screen.getByTestId("connecting").textContent).toBe("false");

      // Start connection
      await act(async () => {
        await user.click(screen.getByTestId("connect"));
        await jest.runAllTimersAsync();
      });

      // After connection completes, isConnecting should be false
      await waitFor(() => {
        expect(screen.getByTestId("connecting").textContent).toBe("false");
      });
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("key").textContent).toBe("GNEWKEY");
    });

    it("isConnecting is set to false when connection fails", async () => {
      mockIsFreighterInstalled.mockResolvedValue(true);
      mockGetConnectedPublicKey.mockResolvedValue(null);
      mockConnectFreighter.mockRejectedValue(new Error("User denied"));

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      render(
        <WalletProvider>
          <WalletTestComponent />
        </WalletProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED");
      });

      await act(async () => {
        await user.click(screen.getByTestId("connect"));
        await jest.runAllTimersAsync();
      });

      // isConnecting should be false after failure
      await waitFor(() => {
        expect(screen.getByTestId("connecting").textContent).toBe("false");
      });
      // Status should be back to DISCONNECTED
      expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED");
      // Error should be set
      expect(screen.getByTestId("error").textContent).not.toBe("none");
    });

    it("isConnecting is set to false when connection succeeds but network is wrong", async () => {
      mockIsFreighterInstalled.mockResolvedValue(true);
      mockGetConnectedPublicKey.mockResolvedValue(null);
      mockConnectFreighter.mockResolvedValue({
        publicKey: "GWRONGNET",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      });

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      render(
        <WalletProvider>
          <WalletTestComponent />
        </WalletProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED");
      });

      await act(async () => {
        await user.click(screen.getByTestId("connect"));
        await jest.runAllTimersAsync();
      });

      // isConnecting should be false after connection attempt
      await waitFor(() => {
        expect(screen.getByTestId("connecting").textContent).toBe("false");
      });
      // Status should be WRONG_NETWORK
      expect(screen.getByTestId("status").textContent).toBe("WRONG_NETWORK");
      // Error should be set
      expect(screen.getByTestId("error").textContent).toContain("Wrong network");
    });

    it("correctly updates isConnecting state during full connection lifecycle", async () => {
      mockIsFreighterInstalled.mockResolvedValue(true);
      mockGetConnectedPublicKey.mockResolvedValue(null);

      // Track the state changes
      const stateChanges: { isConnecting: boolean; status: string }[] = [];

      // Create a promise to manually control connection timing
      let resolveConnect: (value: {
        publicKey: string;
        networkPassphrase: string;
      }) => void;
      const connectPromise = new Promise<{
        publicKey: string;
        networkPassphrase: string;
      }>((resolve) => {
        resolveConnect = resolve;
      });
      mockConnectFreighter.mockReturnValue(connectPromise);

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      render(
        <WalletProvider>
          <WalletTestComponent />
        </WalletProvider>,
      );

      // Wait for initial state
      await waitFor(() => {
        expect(screen.getByTestId("status").textContent).toBe("DISCONNECTED");
      });

      // Record initial state
      stateChanges.push({
        isConnecting: screen.getByTestId("connecting").textContent === "true",
        status: screen.getByTestId("status").textContent || "",
      });

      // Start connection
      await act(async () => {
        await user.click(screen.getByTestId("connect"));
      });

      // Wait for connecting state
      await waitFor(() => {
        expect(screen.getByTestId("connecting").textContent).toBe("true");
      });

      // Record connecting state
      stateChanges.push({
        isConnecting: true,
        status: screen.getByTestId("status").textContent || "",
      });

      // Complete the connection
      await act(async () => {
        resolveConnect!({
          publicKey: "GCONNECTED",
          networkPassphrase: "Test SDF Network ; September 2015",
        });
        await jest.runAllTimersAsync();
      });

      // Wait for connected state
      await waitFor(() => {
        expect(screen.getByTestId("status").textContent).toBe("CONNECTED");
      });

      // Record final state
      stateChanges.push({
        isConnecting: screen.getByTestId("connecting").textContent === "true",
        status: screen.getByTestId("status").textContent || "",
      });

      // Verify the lifecycle: false (disconnected) -> true (connecting) -> false (connected)
      expect(stateChanges[0].isConnecting).toBe(false);
      expect(stateChanges[0].status).toBe("DISCONNECTED");

      expect(stateChanges[1].isConnecting).toBe(true);
      expect(stateChanges[1].status).toBe("CONNECTING");

      expect(stateChanges[2].isConnecting).toBe(false);
      expect(stateChanges[2].status).toBe("CONNECTED");
    });
  });
});
