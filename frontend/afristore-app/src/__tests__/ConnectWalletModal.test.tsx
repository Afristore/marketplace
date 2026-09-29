/**
 * Component tests for ConnectWalletModal.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockConnect = jest.fn();
const mockRefresh = jest.fn();
let mockStatus = "DISCONNECTED";
let mockIsConnecting = false;
let mockError: string | null = null;
let mockPublicKey: string | null = null;

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    status: mockStatus,
    connect: mockConnect,
    isConnecting: mockIsConnecting,
    error: mockError,
    publicKey: mockPublicKey,
    refresh: mockRefresh,
  }),
}));

jest.mock("@/components/MagicWalletModal", () => ({
  MagicWalletModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="magic-modal" /> : null,
}));

jest.mock("@/lib/config", () => ({
  config: { network: "testnet" },
}));

jest.mock("posthog-js", () => ({
  capture: jest.fn(),
}));

jest.mock("lucide-react", () =>
  Object.fromEntries(
    [
      "X",
      "Wallet",
      "ExternalLink",
      "ShieldCheck",
      "AlertTriangle",
      "ArrowRight",
      "Loader2",
      "CheckCircle2",
      "Mail",
    ].map((name) => [name, () => <span />]),
  ),
);

import { ConnectWalletModal } from "@/components/ConnectWalletModal";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ConnectWalletModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = "DISCONNECTED";
    mockIsConnecting = false;
    mockError = null;
    mockPublicKey = null;
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <ConnectWalletModal isOpen={false} onClose={jest.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the modal with Freighter option", () => {
    render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);
    expect(screen.getByText(/freighter wallet/i)).toBeInTheDocument();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    const { container } = render(
      <ConnectWalletModal isOpen={true} onClose={onClose} />,
    );
    const backdrop = container.querySelector(".absolute.inset-0");
    if (backdrop) {
      await user.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it("calls connect when the Freighter Wallet button is clicked", async () => {
    const user = userEvent.setup();
    render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);
    // The Freighter button contains "Freighter Wallet" text
    const connectBtn = screen.getByRole("button", {
      name: /freighter wallet/i,
    });
    await user.click(connectBtn);
    expect(mockConnect).toHaveBeenCalled();
  });

  it("shows error message when error is set", () => {
    mockError = "Connection rejected";
    render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);
    expect(screen.getByText(/connection rejected/i)).toBeInTheDocument();
  });

  // Issue #945: a rejected connect() used to escape as an unhandled rejection —
  // the button appeared dead and the user was never told why.
  it("surfaces the reason when connect() rejects", async () => {
    mockConnect.mockRejectedValueOnce(new Error("User rejected the request"));
    const user = userEvent.setup();
    render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /freighter wallet/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /user rejected the request/i,
    );
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    mockConnect.mockRejectedValueOnce("boom");
    const user = userEvent.setup();
    render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /freighter wallet/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not connect to your wallet/i,
    );
  });

  it("clears a previous failure when the user retries", async () => {
    mockConnect.mockRejectedValueOnce(new Error("User rejected the request"));
    const user = userEvent.setup();
    render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);
    const button = screen.getByRole("button", { name: /freighter wallet/i });

    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(/user rejected/i);

    mockConnect.mockResolvedValueOnce(undefined);
    await user.click(button);

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("shows Magic Wallet as coming soon", () => {
    render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);
    expect(screen.getByText(/magic wallet/i)).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
