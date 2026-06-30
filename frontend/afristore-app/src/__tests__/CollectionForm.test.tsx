/**
 * Component tests for CollectionForm.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockDeploy = jest.fn();
let mockPublicKey: string | null = "GPUBKEY";

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({ publicKey: mockPublicKey }),
}));

jest.mock("@/hooks/useLaunchpad", () => ({
  useDeployCollection: () => ({
    deploy: mockDeploy,
    isDeploying: false,
    error: null,
  }),
}));

jest.mock("@/hooks/useSupportedTokens", () => ({
  useSupportedTokens: () => ({
    tokens: [{ address: "CTOKEN", code: "XLM", issuer: "" }],
  }),
}));

jest.mock("@/lib/token-support", () => ({
  getDefaultSupportedToken: (tokens: { address: string }[]) => tokens[0],
}));

jest.mock("@/config/tokens", () => ({
  DEFAULT_TOKEN: { address: "CTOKEN" },
}));

jest.mock("@/lib/launchpad", () => ({}));

jest.mock("@/components/WalletGuard", () => ({
  GuardButton: ({
    children,
    onAction,
    disabled,
  }: {
    children: React.ReactNode;
    onAction?: () => void;
    disabled?: boolean;
  }) => (
    <button type="submit" onClick={onAction} disabled={disabled}>
      {children}
    </button>
  ),
}));

jest.mock("lucide-react", () =>
  Object.fromEntries(
    ["Loader2", "Rocket", "CheckCircle", "ArrowRight", "Info", "ChevronDown"].map((name) => [
      name,
      () => <span />,
    ]),
  ),
);

import { CollectionForm } from "@/components/CollectionForm";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CollectionForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPublicKey = "GPUBKEY";
  });

  it("renders the collection name input", () => {
    render(<CollectionForm />);
    expect(screen.getByPlaceholderText(/african legends/i)).toBeInTheDocument();
  });

  it("renders the symbol input", () => {
    render(<CollectionForm />);
    expect(screen.getByPlaceholderText(/AFRL/i)).toBeInTheDocument();
  });

  it("renders a deploy/launch button", () => {
    render(<CollectionForm />);
    expect(
      screen.getByRole("button", { name: /deploy|launch/i }),
    ).toBeInTheDocument();
  });

  it("calls deploy when form is submitted with valid data", async () => {
    mockDeploy.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(<CollectionForm />);

    const nameInput = screen.getByPlaceholderText(/african legends/i);
    const symbolInput = screen.getByPlaceholderText(/AFRL/i);
    await user.clear(nameInput);
    await user.type(nameInput, "My Collection");
    await user.clear(symbolInput);
    await user.type(symbolInput, "MC");

    await user.click(screen.getByRole("button", { name: /deploy|launch/i }));
    await waitFor(() => expect(mockDeploy).toHaveBeenCalled());
  });

  it("shows success state with deployed address", async () => {
    mockDeploy.mockResolvedValueOnce("CDEPLOYED_ADDRESS_123");
    const user = userEvent.setup();
    render(<CollectionForm />);

    await user.type(
      screen.getByPlaceholderText(/african legends/i),
      "My Collection",
    );
    await user.type(screen.getByPlaceholderText(/AFRL/i), "MC");
    await user.click(screen.getByRole("button", { name: /deploy|launch/i }));

    await waitFor(() =>
      expect(screen.getByText(/collection deployed/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/CDEPLOYED_ADDRESS_123/)).toBeInTheDocument();
  });

  it("renders the Royalty (BPS) label", () => {
    render(<CollectionForm />);
    expect(screen.getByText(/royalty.*bps/i)).toBeInTheDocument();
  });

  it("renders the Max Supply label", () => {
    render(<CollectionForm />);
    expect(screen.getByText(/max supply/i)).toBeInTheDocument();
  });
});
