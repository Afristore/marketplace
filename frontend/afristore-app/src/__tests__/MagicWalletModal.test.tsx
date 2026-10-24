/**
 * Component tests for MagicWalletModal.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockLoginWithEmail = jest.fn();
const mockLoginWithPasskey = jest.fn();
const mockLogout = jest.fn();
const mockRefresh = jest.fn();

let mockStatus = "DISCONNECTED";
let mockError: string | null = null;
let mockEmail: string | null = null;
let mockPublicAddress: string | null = null;

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    magic: {
      status: mockStatus,
      isConnecting: false,
      error: mockError,
      email: mockEmail,
      publicAddress: mockPublicAddress,
      loginWithEmail: mockLoginWithEmail,
      loginWithPasskey: mockLoginWithPasskey,
      logout: mockLogout,
      refresh: mockRefresh,
    },
  }),
}));

jest.mock("lucide-react", () =>
  Object.fromEntries(
    [
      "X",
      "Mail",
      "Fingerprint",
      "ExternalLink",
      "AlertTriangle",
      "ArrowRight",
      "Loader2",
      "CheckCircle2",
    ].map((name) => [name, () => <span />]),
  ),
);

import { MagicWalletModal } from "@/components/MagicWalletModal";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MagicWalletModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = "DISCONNECTED";
    mockError = null;
    mockEmail = null;
    mockPublicAddress = null;
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <MagicWalletModal isOpen={false} onClose={jest.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders modal content when isOpen is true", () => {
    render(<MagicWalletModal isOpen={true} onClose={jest.fn()} />);
    // The modal shows "Magic" in the title
    expect(screen.getByText("Magic")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    try {
      const onClose = jest.fn();
      const user = userEvent.setup();
      render(<MagicWalletModal isOpen={true} onClose={onClose} />);
      // The X close button is the first button
      const buttons = screen.getAllByRole("button");
      await user.click(buttons[0]);
      expect(onClose).toHaveBeenCalled();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("shows email input form when Email Magic Link is clicked", async () => {
    try {
      const user = userEvent.setup();
      render(<MagicWalletModal isOpen={true} onClose={jest.fn()} />);
      // "Email Magic Link" button triggers setShowEmailForm(true)
      await user.click(screen.getByRole("button", { name: /email magic link/i }));
      await waitFor(() =>
        expect(
          screen.getByPlaceholderText(/you@example\.com/i),
        ).toBeInTheDocument(),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("calls loginWithEmail when email form is submitted", async () => {
    try {
      mockLoginWithEmail.mockResolvedValueOnce(undefined);
      const user = userEvent.setup();
      render(<MagicWalletModal isOpen={true} onClose={jest.fn()} />);

      await user.click(screen.getByRole("button", { name: /email magic link/i }));
      const input = await screen.findByPlaceholderText(/you@example\.com/i);
      await user.type(input, "user@test.com");
      // Submit button text is "Send Magic Link" or similar
      const submitBtn = screen.getByRole("button", {
        name: /send magic link|continue/i,
      });
      await user.click(submitBtn);

      await waitFor(() =>
        expect(mockLoginWithEmail).toHaveBeenCalledWith("user@test.com"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("calls loginWithPasskey when Passkey Login is clicked", async () => {
    try {
      mockLoginWithPasskey.mockResolvedValueOnce(undefined);
      const user = userEvent.setup();
      render(<MagicWalletModal isOpen={true} onClose={jest.fn()} />);

      const passkeyBtn = screen.getByRole("button", { name: /passkey login/i });
      await user.click(passkeyBtn);
      await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalled());
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("displays error message when login fails in context", () => {
    mockError = "Login failed";
    render(<MagicWalletModal isOpen={true} onClose={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/login failed/i);
  });

  it("handles rejection and displays error message when loginWithEmail rejects", async () => {
    try {
      mockLoginWithEmail.mockRejectedValueOnce(new Error("Email delivery failed"));
      const user = userEvent.setup();
      render(<MagicWalletModal isOpen={true} onClose={jest.fn()} />);

      await user.click(screen.getByRole("button", { name: /email magic link/i }));
      const input = await screen.findByPlaceholderText(/you@example\.com/i);
      await user.type(input, "error@test.com");
      const submitBtn = screen.getByRole("button", {
        name: /send magic link|continue/i,
      });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /Email delivery failed/i,
        );
      });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles rejection and displays error message when loginWithPasskey rejects", async () => {
    try {
      mockLoginWithPasskey.mockRejectedValueOnce(new Error("Passkey biometric cancelled"));
      const user = userEvent.setup();
      render(<MagicWalletModal isOpen={true} onClose={jest.fn()} />);

      const passkeyBtn = screen.getByRole("button", { name: /passkey login/i });
      await user.click(passkeyBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /Passkey biometric cancelled/i,
        );
      });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("calls onClose when backdrop is clicked", async () => {
    try {
      const onClose = jest.fn();
      const user = userEvent.setup();
      const { container } = render(
        <MagicWalletModal isOpen={true} onClose={onClose} />,
      );
      // The backdrop is the first absolutely-positioned overlay div
      const backdrop = container.querySelector(".absolute.inset-0");
      if (backdrop) {
        await user.click(backdrop);
        expect(onClose).toHaveBeenCalled();
      }
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
