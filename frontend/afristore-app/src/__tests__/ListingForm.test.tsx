import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListingForm } from "@/components/ListingForm";
import type { Listing } from "@/lib/contract";

// Mock dependencies
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
let mockCreateError: string | null = null;
let mockUpdateError: string | null = null;
let mockIsCreating = false;
let mockIsUpdating = false;

jest.mock("@/hooks/useMarketplace", () => ({
  useCreateListing: () => ({
    create: mockCreate,
    isCreating: mockIsCreating,
    progress: "",
    error: mockCreateError,
  }),
  useUpdateListing: () => ({
    update: mockUpdate,
    isUpdating: mockIsUpdating,
    progress: "",
    error: mockUpdateError,
  }),
}));

const mockSupportedTokens = [
  {
    address: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
    name: "Stellar Lumens",
    symbol: "XLM",
    decimals: 7,
  },
];

jest.mock("@/hooks/useSupportedTokens", () => ({
  useSupportedTokens: () => ({ tokens: mockSupportedTokens }),
}));

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    publicKey: "GABC123",
    isConnected: true,
    isWrongNetwork: false,
    status: "connected",
  }),
}));

jest.mock("@/components/ConnectWalletModal", () => ({
  ConnectWalletModal: () => null,
}));

const mockFetchMetadata = jest.fn();
jest.mock("@/lib/ipfs", () => ({
  fetchMetadata: (...args: unknown[]) => mockFetchMetadata(...args),
  cidToGatewayUrl: (cid: string) => `https://ipfs.io/ipfs/${cid}`,
}));

jest.mock("posthog-js", () => ({
  capture: jest.fn(),
}));

jest.mock("@/lib/contract", () => ({
  stroopsToXlm: (v: bigint) => String(Number(v) / 10_000_000),
}));

const dummyListing: Listing = {
  listing_id: 42,
  owner: "GABC123",
  artist: "GARTIST",
  metadata_cid: "QmTestCID",
  collection: "CAAA",
  token_id: 1,
  price: 250_000_000n, // 25 XLM
  currency: "XLM",
  token: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  recipients: [],
  status: "Active" as const,
  created_at: 1000,
};

describe("ListingForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue(123);
    mockUpdate.mockResolvedValue(true);
    mockCreateError = null;
    mockUpdateError = null;
    mockIsCreating = false;
    mockIsUpdating = false;
    mockFetchMetadata.mockResolvedValue({
      title: "Ancient Mask",
      description: "Carved wooden mask",
      image: "QmImage",
    });
  });

  it("renders form fields and submit button", async () => {
    try {
      render(<ListingForm onSuccess={() => {}} onCancel={() => {}} />);

      const collectionAddress = screen.getByPlaceholderText(/e.g. C.../i);
      expect(collectionAddress).toBeInTheDocument();

      const submit = screen.getByRole("button", { name: /Create Listing/i });
      expect(submit).toBeInTheDocument();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("submits the form successfully and displays success message", async () => {
    try {
      const onSuccess = jest.fn();
      const user = userEvent.setup();

      render(<ListingForm onSuccess={onSuccess} onCancel={() => {}} />);

      const collectionInput = screen.getByPlaceholderText(/e.g. C.../i);
      await user.type(collectionInput, "CAAA12345");

      const submitBtn = screen.getByRole("button", { name: /Create Listing/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
        expect(screen.getByText(/Listing #123 Created!/i)).toBeInTheDocument();
        expect(onSuccess).toHaveBeenCalledWith(123);
      });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles create error gracefully without crashing when create throws", async () => {
    try {
      mockCreate.mockRejectedValueOnce(new Error("Wallet rejected transaction"));
      const user = userEvent.setup();

      render(<ListingForm onSuccess={() => {}} onCancel={() => {}} />);

      const collectionInput = screen.getByPlaceholderText(/e.g. C.../i);
      await user.type(collectionInput, "CAAA12345");

      const submitBtn = screen.getByRole("button", { name: /Create Listing/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText("Wallet rejected transaction")).toBeInTheDocument();
      });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("displays createError from useCreateListing hook when present", async () => {
    try {
      mockCreateError = "Gas estimation failed";
      render(<ListingForm onSuccess={() => {}} onCancel={() => {}} />);

      expect(screen.getByText("Gas estimation failed")).toBeInTheDocument();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles metadata loading error in edit mode gracefully without crashing", async () => {
    try {
      mockFetchMetadata.mockRejectedValueOnce(new Error("Failed to reach IPFS gateway"));

      render(
        <ListingForm
          listing={dummyListing}
          onSuccess={() => {}}
          onCancel={() => {}}
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByText("Failed to reach IPFS gateway"),
        ).toBeInTheDocument();
      });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("submits update successfully in edit mode", async () => {
    try {
      const onSuccess = jest.fn();
      const user = userEvent.setup();

      render(
        <ListingForm
          listing={dummyListing}
          onSuccess={onSuccess}
          onCancel={() => {}}
        />,
      );

      await waitFor(() => {
        expect(mockFetchMetadata).toHaveBeenCalledWith("QmTestCID");
      });

      const updateBtn = screen.getByRole("button", { name: /Update Listing/i });
      await user.click(updateBtn);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
        expect(screen.getByText(/Listing #42 Updated!/i)).toBeInTheDocument();
        expect(onSuccess).toHaveBeenCalledWith(42);
      });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles update error gracefully when update rejects", async () => {
    try {
      mockUpdate.mockRejectedValueOnce(new Error("Contract execution reverted"));
      const user = userEvent.setup();

      render(
        <ListingForm
          listing={dummyListing}
          onSuccess={() => {}}
          onCancel={() => {}}
        />,
      );

      await waitFor(() => {
        expect(mockFetchMetadata).toHaveBeenCalledWith("QmTestCID");
      });

      const updateBtn = screen.getByRole("button", { name: /Update Listing/i });
      await user.click(updateBtn);

      await waitFor(() => {
        expect(screen.getByText("Contract execution reverted")).toBeInTheDocument();
      });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
