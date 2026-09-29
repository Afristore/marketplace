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

describe("Lending Module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue("/lending/lend");
    mockWalletState = {
      publicKey: "G_USER_123",
      isConnected: true,
      isConnecting: false,
      connect: jest.fn(),
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

    it("renders empty state when user holds no valid NFTs", () => {
      mockOwnedNFTsState.tokens = [];
      render(<LendPage />);

      expect(screen.getByTestId("lending-nfts-empty")).toBeInTheDocument();
      expect(screen.getByText("No NFTs Found in Connected Wallet")).toBeInTheDocument();
      expect(screen.getByText("Explore Marketplace")).toBeInTheDocument();
    });

    it("displays owned NFTs and allows selecting an NFT to configure loan terms", async () => {
      mockOwnedNFTsState.tokens = [
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
    });
  });
});
