/**
 * Unit tests for the lending module:
 * - LendingLayout (app/lending/layout)
 * - LendPage (app/lending/lend/page)
 *
 * Error handling contract covered here (issue #1044):
 *   • every async interaction is awaited inside a try/catch, in the test
 *     bodies as well as in the components' event handlers, so a rejected
 *     wallet or contract call can never escape as an unhandled promise
 *     rejection and take the React tree down;
 *   • a failure is surfaced to the user as a visible error state — the
 *     page renders an alert with the reason — and never silently
 *     swallowed: the tests assert the message, not just that something
 *     happened;
 *   • a global `unhandledRejection` listener fails the suite if any promise
 *     is ever left unhandled.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import LendingLayout from "@/app/lending/layout";
import LendPage from "@/app/lending/lend/page";

// ── Dependency mocks ──────────────────────────────────────────────────────────

const mockUsePathname = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

let mockWalletState = {
  publicKey: "G_USER_123",
  isConnected: true,
  isConnecting: false,
  connect: jest.fn(),
};

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => mockWalletState,
}));

let mockIsAdmin = false;
jest.mock("@/hooks/useAdmin", () => ({
  useAdminCheck: () => ({
    isAdmin: mockIsAdmin,
    isLoading: false,
  }),
}));

let mockOwnedNFTsState = {
  tokens: [] as any[],
  isLoading: false,
  error: null as string | null,
  refresh: jest.fn(),
};

jest.mock("@/hooks/useOwnedNFTs", () => ({
  useOwnedNFTs: () => mockOwnedNFTsState,
}));

// ── Unhandled rejection guard ────────────────────────────────────────────────

const unhandledRejections: unknown[] = [];

function trackUnhandledRejection(reason: unknown) {
  unhandledRejections.push(reason);
}

beforeAll(() => {
  process.on("unhandledRejection", trackUnhandledRejection);
});

afterAll(() => {
  process.off("unhandledRejection", trackUnhandledRejection);
});

afterEach(async () => {
  // Give the microtask queue a chance to surface a late rejection before
  // the next test starts.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(unhandledRejections).toEqual([]);
  unhandledRejections.length = 0;
  jest.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const ownedNfts = [
  {
    collectionAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    tokenId: 1,
    name: "Savanna Mask #1",
    image: "https://ipfs.io/ipfs/sample1.png",
  },
  {
    collectionAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    tokenId: 2,
    name: "Golden Benin Bronze #2",
    image: "https://ipfs.io/ipfs/sample2.png",
  },
];

describe("Lending Module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue("/lending/lend");
    mockWalletState = {
      publicKey: "G_USER_123",
      isConnected: true,
      isConnecting: false,
      connect: jest.fn().mockResolvedValue(undefined),
    };
    mockIsAdmin = false;
    mockOwnedNFTsState = {
      tokens: [],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
  });

  describe("LendingLayout", () => {
    it("renders core navigation tabs", () => {
      render(
        <LendingLayout>
          <div>Lending Content</div>
        </LendingLayout>
      );

      expect(screen.getByText("NFT Lending & Borrowing")).toBeInTheDocument();
      expect(screen.getByText("Borrow")).toBeInTheDocument();
      expect(screen.getByText("Lend")).toBeInTheDocument();
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.queryByText("Admin")).not.toBeInTheDocument();
      expect(screen.getByText("Lending Content")).toBeInTheDocument();
    });

    it("displays Admin tab when user is an admin", () => {
      mockIsAdmin = true;
      render(
        <LendingLayout>
          <div>Admin View</div>
        </LendingLayout>
      );

      expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
    });

    it("highlights active tab matching current pathname", () => {
      mockUsePathname.mockReturnValue("/lending/lend");
      render(
        <LendingLayout>
          <div>Lend View</div>
        </LendingLayout>
      );

      const lendLink = screen.getByText("Lend").closest("a");
      expect(lendLink?.className).toContain("from-brand-500");
    });
  });

  describe("LendPage", () => {
    it("renders connect wallet prompt if disconnected", () => {
      mockWalletState.isConnected = false;
      mockWalletState.publicKey = "";

      render(<LendPage />);

      expect(screen.getByText("Connect Your Stellar Wallet")).toBeInTheDocument();
      const connectBtn = screen.getByRole("button", { name: /Connect Wallet/i });
      fireEvent.click(connectBtn);
      expect(mockWalletState.connect).toHaveBeenCalled();
    });

    it("shows an error message when the wallet connection fails", async () => {
      try {
        mockWalletState.isConnected = false;
        mockWalletState.publicKey = "";
        mockWalletState.connect = jest
          .fn()
          .mockRejectedValue(new Error("wallet extension missing"));

        render(<LendPage />);

        const connectBtn = screen.getByRole("button", { name: /Connect Wallet/i });
        fireEvent.click(connectBtn);

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain(
          "Could not connect your wallet. Please try again.",
        );
        expect(mockWalletState.connect).toHaveBeenCalled();
      } catch (err) {
        throw err;
      }
    });

    it("renders empty state when user holds no valid NFTs", () => {
      mockOwnedNFTsState.tokens = [];
      render(<LendPage />);

      expect(screen.getByTestId("lending-nfts-empty")).toBeInTheDocument();
      expect(screen.getByText("No NFTs Found in Connected Wallet")).toBeInTheDocument();
      expect(screen.getByText("Explore Marketplace")).toBeInTheDocument();
    });

    it("shows the load error and a retry action when the NFT list fails", async () => {
      try {
        mockOwnedNFTsState.error = "indexer unreachable";

        render(<LendPage />);

        expect(screen.getByText("Failed to load NFTs")).toBeInTheDocument();
        expect(screen.getByText("indexer unreachable")).toBeInTheDocument();
        expect(screen.queryByTestId("lending-nfts-empty")).not.toBeInTheDocument();

        const retry = screen.getByRole("button", { name: /Try Again/i });
        fireEvent.click(retry);
        expect(mockOwnedNFTsState.refresh).toHaveBeenCalled();
      } catch (err) {
        throw err;
      }
    });

    it("displays owned NFTs and allows selecting an NFT to configure loan terms", async () => {
      try {
        mockOwnedNFTsState.tokens = ownedNfts;

        render(<LendPage />);

        expect(screen.getByText("Your NFTs (2)")).toBeInTheDocument();
        expect(screen.getByText("Savanna Mask #1")).toBeInTheDocument();
        expect(screen.getByText("Golden Benin Bronze #2")).toBeInTheDocument();

        // Initially prompt to select NFT
        expect(screen.getByText("Select an NFT from the list to begin creating a loan listing")).toBeInTheDocument();

        // Click first NFT
        fireEvent.click(screen.getByText("Savanna Mask #1"));

        // Terms form appears with selected NFT
        expect(screen.getByText("Declared Price / Loan Amount (USD)")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Create Lending Listing/i })).toBeInTheDocument();

        // Submit listing
        fireEvent.click(screen.getByRole("button", { name: /Create Lending Listing/i }));

        await waitFor(() => {
          expect(screen.getByText("NFT successfully listed for lending!")).toBeInTheDocument();
        });
      } catch (err) {
        throw err;
      }
    });

    it("shows an error message when the listing creation fails", async () => {
      try {
        mockOwnedNFTsState.tokens = ownedNfts;
        render(<LendPage />);

        fireEvent.click(screen.getByText("Savanna Mask #1"));

        // The listing transaction is simulated with a timer; make that
        // timer throw so the failure path of the page is exercised.
        const setTimeoutSpy = jest
          .spyOn(global, "setTimeout")
          .mockImplementationOnce(() => {
            throw new Error("network unreachable");
          });

        fireEvent.click(screen.getByRole("button", { name: /Create Lending Listing/i }));

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain(
          "Failed to create the lending listing. Please try again.",
        );
        expect(
          screen.queryByText("NFT successfully listed for lending!"),
        ).not.toBeInTheDocument();
        setTimeoutSpy.mockRestore();
      } catch (err) {
        throw err;
      }
    });

    it("keeps the submit button disabled when the declared amount is not positive", async () => {
      try {
        mockOwnedNFTsState.tokens = ownedNfts;
        render(<LendPage />);

        fireEvent.click(screen.getByText("Savanna Mask #1"));

        const amount = screen.getByRole("spinbutton") as HTMLInputElement;
        expect(amount.value).toBe("100");
        fireEvent.change(amount, { target: { value: "0" } });

        expect(
          screen.getByRole("button", { name: /Create Lending Listing/i }),
        ).toBeDisabled();
      } catch (err) {
        throw err;
      }
    });
  });
});
