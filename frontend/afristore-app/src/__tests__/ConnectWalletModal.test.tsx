/**
 * Component tests for ConnectWalletModal.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
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
    try {
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
    } catch (error) {
      console.error("Failed to test backdrop click:", error);
      throw error;
    }
  });

  it("calls connect when the Freighter Wallet button is clicked", async () => {
    try {
      const user = userEvent.setup();
      render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);
      // The Freighter button contains "Freighter Wallet" text
      const connectBtn = screen.getByRole("button", {
        name: /freighter wallet/i,
      });
      await user.click(connectBtn);
      expect(mockConnect).toHaveBeenCalled();
    } catch (error) {
      console.error("Failed to test Freighter wallet connection:", error);
      throw error;
    }
  });

  it("shows error message when error is set", () => {
    mockError = "Connection rejected";
    render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);
    expect(screen.getByText(/connection rejected/i)).toBeInTheDocument();
  });

  it("shows Magic Wallet as coming soon", () => {
    render(<ConnectWalletModal isOpen={true} onClose={jest.fn()} />);
    expect(screen.getByText(/magic wallet/i)).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
