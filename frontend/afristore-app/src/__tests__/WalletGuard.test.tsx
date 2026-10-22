/**
 * Component tests for WalletGuard and GuardButton.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockWalletContext = {
  isConnected: true,
  isWrongNetwork: false,
  status: "connected" as const,
  publicKey: "GPUBKEY",
  connect: jest.fn(),
  disconnect: jest.fn(),
  refresh: jest.fn(),
  isInstalled: true,
  isConnecting: false,
  error: null,
  networkPassphrase: null,
};

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => mockWalletContext,
}));

// ConnectWalletModal — render nothing to keep tests simple
jest.mock("@/components/ConnectWalletModal", () => ({
  ConnectWalletModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="connect-modal" /> : null,
}));

jest.mock("lucide-react", () => ({
  Wallet: () => <span />,
  AlertTriangle: () => <span />,
}));

import { WalletGuard, GuardButton } from "@/components/WalletGuard";

// ── WalletGuard ───────────────────────────────────────────────────────────────

describe("WalletGuard", () => {
  beforeEach(() => {
    mockWalletContext.isConnected = true;
    mockWalletContext.isWrongNetwork = false;
    jest.clearAllMocks();
  });

  it("renders children when wallet is connected", () => {
    render(
      <WalletGuard>
        <span data-testid="child">Protected Content</span>
      </WalletGuard>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders the default fallback (Connect Wallet) when disconnected", () => {
    mockWalletContext.isConnected = false;
    render(
      <WalletGuard>
        <span data-testid="child">Protected Content</span>
      </WalletGuard>,
    );
    expect(
      screen.getByRole("button", { name: /connect wallet/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
  });

  it("renders custom fallback when provided and disconnected", () => {
    mockWalletContext.isConnected = false;
    render(
      <WalletGuard fallback={<span data-testid="custom-fallback">Login</span>}>
        <span>Protected</span>
      </WalletGuard>,
    );
    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
  });

  it("opens ConnectWalletModal when Connect Wallet button is clicked while disconnected", async () => {
    mockWalletContext.isConnected = false;
    const user = userEvent.setup();
    render(
      <WalletGuard>
        <span>Protected</span>
      </WalletGuard>,
    );
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() =>
      expect(screen.getByTestId("connect-modal")).toBeInTheDocument(),
    );
  });
});

// ── GuardButton ───────────────────────────────────────────────────────────────

describe("GuardButton", () => {
  beforeEach(() => {
    mockWalletContext.isConnected = true;
    mockWalletContext.isWrongNetwork = false;
    jest.clearAllMocks();
  });

  it("calls onAction when wallet is connected", async () => {
    const onAction = jest.fn();
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Buy Now</GuardButton>);
    await user.click(screen.getByRole("button", { name: /buy now/i }));
    expect(onAction).toHaveBeenCalled();
  });

  it("opens ConnectWalletModal and does NOT call onAction when wallet is disconnected", async () => {
    mockWalletContext.isConnected = false;
    const onAction = jest.fn();
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Buy Now</GuardButton>);
    await user.click(screen.getByRole("button", { name: /buy now/i }));
    expect(onAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("connect-modal")).toBeInTheDocument(),
    );
  });

  it("opens ConnectWalletModal when wallet is on wrong network", async () => {
    mockWalletContext.isConnected = true;
    mockWalletContext.isWrongNetwork = true;
    const onAction = jest.fn();
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Buy Now</GuardButton>);
    await user.click(screen.getByRole("button", { name: /buy now/i }));
    expect(onAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("connect-modal")).toBeInTheDocument(),
    );
  });

  it("respects the disabled prop", () => {
    render(
      <GuardButton onAction={jest.fn()} disabled>
        Disabled
      </GuardButton>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

// ── GuardButton async error handling ──────────────────────────────────────────

describe("GuardButton — async error handling", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockWalletContext.isConnected = true;
    mockWalletContext.isWrongNetwork = false;
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("awaits an async onAction and shows nothing on success", async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Buy Now</GuardButton>);

    await user.click(screen.getByRole("button", { name: /buy now/i }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("catches a rejected async onAction and shows the error", async () => {
    const onAction = jest.fn().mockRejectedValue(new Error("Network down"));
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Buy Now</GuardButton>);

    await user.click(screen.getByRole("button", { name: /buy now/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "GuardButton action failed:",
      expect.any(Error),
    );
    // The button stays usable after a failure.
    expect(screen.getByRole("button", { name: /buy now/i })).toBeEnabled();
  });

  it("catches an onAction that throws synchronously", async () => {
    const onAction = jest.fn(() => {
      throw new Error("Sync failure");
    });
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Buy Now</GuardButton>);

    await user.click(screen.getByRole("button", { name: /buy now/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sync failure");
  });

  it("uses a generic message for non-Error rejections", async () => {
    const onAction = jest.fn().mockRejectedValue({ code: 500 });
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Buy Now</GuardButton>);

    await user.click(screen.getByRole("button", { name: /buy now/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );
  });

  it("maps Soroban contract errors to a readable message", async () => {
    const onAction = jest
      .fn()
      .mockRejectedValue(new Error("HostError: Error(Contract, #11)"));
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Bid</GuardButton>);

    await user.click(screen.getByRole("button", { name: /bid/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your bid is too low for this auction. (code 11)",
    );
  });

  it("clears the error when a retry succeeds", async () => {
    const onAction = jest
      .fn()
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Buy Now</GuardButton>);
    const button = screen.getByRole("button", { name: /buy now/i });

    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Temporary failure",
    );

    await user.click(button);
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("does not run a failing onAction while disconnected", async () => {
    mockWalletContext.isConnected = false;
    const onAction = jest.fn().mockRejectedValue(new Error("should not run"));
    const user = userEvent.setup();
    render(<GuardButton onAction={onAction}>Buy Now</GuardButton>);

    await user.click(screen.getByRole("button", { name: /buy now/i }));

    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("connect-modal")).toBeInTheDocument();
  });
});
