/**
 * Unit tests for useMarketplace.ts hooks.
 * All external dependencies are mocked.
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetAllListings = jest.fn();
const mockGetListing = jest.fn();
const mockGetArtistListings = jest.fn();
const mockCreateListing = jest.fn();
const mockBuyArtwork = jest.fn();
const mockCancelListing = jest.fn();
const mockUpdateListing = jest.fn();
const mockGetAuction = jest.fn();
const mockPlaceBid = jest.fn();

jest.mock("@/lib/contract", () => ({
  getAllListings: (...args: unknown[]) => mockGetAllListings(...args),
  getListing: (...args: unknown[]) => mockGetListing(...args),
  getArtistListings: (...args: unknown[]) => mockGetArtistListings(...args),
  createListing: (...args: unknown[]) => mockCreateListing(...args),
  buyArtwork: (...args: unknown[]) => mockBuyArtwork(...args),
  cancelListing: (...args: unknown[]) => mockCancelListing(...args),
  updateListing: (...args: unknown[]) => mockUpdateListing(...args),
  getAuction: (...args: unknown[]) => mockGetAuction(...args),
  placeBid: (...args: unknown[]) => mockPlaceBid(...args),
  stroopsToXlm: (_v: bigint) => "1",
}));

jest.mock("@/lib/indexer", () => ({
  fetchListings: jest.fn().mockResolvedValue({ listings: [], total: 0 }),
}));

jest.mock("@/lib/config", () => ({
  config: { indexerUrl: "" },
}));

jest.mock("@/lib/ipfs", () => ({
  uploadImageToIPFS: jest.fn().mockResolvedValue({ cid: "QmImage" }),
  uploadMetadataToIPFS: jest.fn().mockResolvedValue({ cid: "QmMeta" }),
}));

jest.mock("@/lib/errors", () => ({
  getReadableErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

jest.mock("@/lib/token-support", () => ({
  assertSupportedTokenAddress: jest
    .fn()
    .mockResolvedValue({ address: "CTOKEN", code: "XLM" }),
}));

jest.mock("@/hooks/useTransientErrorToast", () => ({
  useTransientErrorToast: jest.fn(),
}));

// useCreateListing now lives in hooks/mutations and raises its own toasts.
jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ pushToast: jest.fn() }),
}));

jest.mock("@/providers/PostHogProvider", () => ({
  trackEvent: {
    listingCreated: jest.fn(),
    artworkPurchased: jest.fn(),
    purchaseSuccessful: jest.fn(),
  },
}));

import {
  useMarketplace,
  useArtistListings,
  useCreateListing,
  useBuyArtwork,
  useCancelListing,
} from "@/hooks/useMarketplace";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeListing(id: number) {
  return {
    listing_id: id,
    artist: "GARTIST",
    metadata_cid: "Qm",
    price: 10_000_000n,
    currency: "XLM",
    token: "CTOKEN",
    recipients: [],
    status: "Active",
    owner: null,
    created_at: id * 100,
    original_creator: "GARTIST",
    royalty_bps: 500,
  };
}

// ── useMarketplace ────────────────────────────────────────────────────────────

describe("useMarketplace", () => {
  beforeEach(() => jest.clearAllMocks());

  it("loads listings from the indexer", async () => {
    try {
      const { fetchListings } = jest.requireMock("@/lib/indexer");
      fetchListings.mockResolvedValueOnce({
        listings: [makeListing(1)],
        total: 1,
      });

      function Comp() {
        const { listings, isLoading } = useMarketplace();
        return (
          <div>
            <span data-testid="count">{listings.length}</span>
            <span data-testid="loading">{String(isLoading)}</span>
          </div>
        );
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("1"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("treats empty indexer response as valid — no on-chain fallback", async () => {
    try {
      const { fetchListings } = jest.requireMock("@/lib/indexer");
      fetchListings.mockResolvedValueOnce({ listings: [], total: 0 });

      function Comp() {
        const { listings } = useMarketplace();
        return <span data-testid="count">{listings.length}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("0"),
      );
      expect(mockGetAllListings).not.toHaveBeenCalled();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("sets error and does not fall back to unbounded on-chain call when indexer throws", async () => {
    try {
      const { fetchListings } = jest.requireMock("@/lib/indexer");
      fetchListings.mockRejectedValueOnce(new Error("indexer down"));

      function Comp() {
        const { listings, error } = useMarketplace();
        return (
          <div>
            <span data-testid="count">{listings.length}</span>
            <span data-testid="error">{error ?? "none"}</span>
          </div>
        );
      }
      render(<Comp />);
      await waitFor(() => {
        expect(screen.getByTestId("error").textContent).not.toBe("none");
      });
      expect(screen.getByTestId("count").textContent).toBe("0");
      expect(mockGetAllListings).not.toHaveBeenCalled();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("sorts listings by created_at descending", async () => {
    try {
      const { fetchListings } = jest.requireMock("@/lib/indexer");
      fetchListings.mockResolvedValueOnce({
        listings: [makeListing(1), makeListing(3), makeListing(2)],
        total: 3,
      });

      function Comp() {
        const { listings } = useMarketplace();
        return (
          <span data-testid="ids">
            {listings.map((l) => l.listing_id).join(",")}
          </span>
        );
      }
      render(<Comp />);
      // sorted desc by created_at (id * 100): 3 > 2 > 1
      await waitFor(() =>
        expect(screen.getByTestId("ids").textContent).toBe("3,2,1"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

// ── useArtistListings ─────────────────────────────────────────────────────────

describe("useArtistListings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does nothing when publicKey is null", () => {
    function Comp() {
      const { listings, isLoading } = useArtistListings(null);
      return (
        <div>
          <span data-testid="count">{listings.length}</span>
          <span data-testid="loading">{String(isLoading)}</span>
        </div>
      );
    }
    render(<Comp />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("fetches listings for an artist", async () => {
    try {
      mockGetArtistListings.mockResolvedValueOnce([1, 2]);
      mockGetListing
        .mockResolvedValueOnce(makeListing(1))
        .mockResolvedValueOnce(makeListing(2));

      function Comp() {
        const { listings } = useArtistListings("GARTIST");
        return <span data-testid="count">{listings.length}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("2"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

// ── useCreateListing ──────────────────────────────────────────────────────────

describe("useCreateListing", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns null when publicKey is null", async () => {
    try {
      function Comp() {
        const { create } = useCreateListing(null);
        const [result, setResult] = React.useState<number | null | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  const res = await create({
                    collectionAddress: "C",
                    nftTokenId: 1,
                    price: 100,
                    tokenAddress: "T",
                  });
                  setResult(res);
                } catch (error) {
                  console.error("Create listing error:", error);
                  setResult(null);
                }
              }}
            >
              c
            </button>
            <span data-testid="result">{String(result)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("null"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("creates a listing and returns id on success", async () => {
    try {
      mockCreateListing.mockResolvedValueOnce(99);

      function Comp() {
        const { create, error } = useCreateListing("GARTIST");
        const [result, setResult] = React.useState<number | null | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  const res = await create({
                    collectionAddress: "C",
                    nftTokenId: 1,
                    price: 100,
                    tokenAddress: "T",
                  });
                  setResult(res);
                } catch (error) {
                  console.error("Create listing error:", error);
                  setResult(null);
                }
              }}
            >
              c
            </button>
            <span data-testid="result">{String(result)}</span>
            <span data-testid="error">{error ?? "none"}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).not.toBe("undefined"),
      );
      // If the result is still null, output the error for debugging
      expect(screen.getByTestId("result").textContent).toBe("99");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

// ── useBuyArtwork ─────────────────────────────────────────────────────────────

describe("useBuyArtwork", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns false when publicKey is null", async () => {
    try {
      function Comp() {
        const { buy } = useBuyArtwork(null);
        const [result, setResult] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  const res = await buy(1);
                  setResult(res);
                } catch (error) {
                  console.error("Buy artwork error:", error);
                  setResult(false);
                }
              }}
            >
              b
            </button>
            <span data-testid="result">{String(result)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("false"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("calls buyArtwork and returns true on success", async () => {
    try {
      mockGetListing.mockResolvedValueOnce(makeListing(7));
      mockBuyArtwork.mockResolvedValueOnce(undefined);

      function Comp() {
        const { buy } = useBuyArtwork("GBUYER");
        const [result, setResult] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  const res = await buy(7);
                  setResult(res);
                } catch (error) {
                  console.error("Buy artwork error:", error);
                  setResult(false);
                }
              }}
            >
              b
            </button>
            <span data-testid="result">{String(result)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("true"),
      );
      expect(mockBuyArtwork).toHaveBeenCalledWith("GBUYER", 7);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns false and sets error when buy fails", async () => {
    try {
      mockGetListing.mockResolvedValueOnce(makeListing(7));
      mockBuyArtwork.mockRejectedValueOnce(new Error("insufficient funds"));

      function Comp() {
        const { buy, error } = useBuyArtwork("GBUYER");
        const [result, setResult] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  const res = await buy(7);
                  setResult(res);
                } catch (error) {
                  console.error("Buy artwork error:", error);
                  setResult(false);
                }
              }}
            >
              b
            </button>
            <span data-testid="result">{String(result)}</span>
            <span data-testid="error">{error ?? "none"}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("false"),
      );
      expect(screen.getByTestId("error").textContent).not.toBe("none");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

// ── useCancelListing ──────────────────────────────────────────────────────────

describe("useCancelListing", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns false when publicKey is null", async () => {
    try {
      function Comp() {
        const { cancel } = useCancelListing(null);
        const [result, setResult] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  const res = await cancel(1);
                  setResult(res);
                } catch (error) {
                  console.error("Cancel listing error:", error);
                  setResult(false);
                }
              }}
            >
              c
            </button>
            <span data-testid="result">{String(result)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("false"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("calls cancelListing and returns true on success", async () => {
    try {
      mockCancelListing.mockResolvedValueOnce(undefined);

      function Comp() {
        const { cancel } = useCancelListing("GARTIST");
        const [result, setResult] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  const res = await cancel(3);
                  setResult(res);
                } catch (error) {
                  console.error("Cancel listing error:", error);
                  setResult(false);
                }
              }}
            >
              c
            </button>
            <span data-testid="result">{String(result)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("true"),
      );
      expect(mockCancelListing).toHaveBeenCalledWith("GARTIST", 3);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
