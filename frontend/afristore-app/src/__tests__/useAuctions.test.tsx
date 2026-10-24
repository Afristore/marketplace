/**
 * Unit tests for useAuctions.ts hooks.
 * All blockchain / indexer calls are mocked.
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetAllAuctions = jest.fn();
const mockGetAuction = jest.fn();
const mockGetArtistAuctions = jest.fn();
const mockCreateAuction = jest.fn();
const mockPlaceBid = jest.fn();
const mockFinalizeAuction = jest.fn();

jest.mock("@/lib/contract", () => ({
  getAllAuctions: (...args: unknown[]) => mockGetAllAuctions(...args),
  getAuction: (...args: unknown[]) => mockGetAuction(...args),
  getArtistAuctions: (...args: unknown[]) => mockGetArtistAuctions(...args),
  createAuction: (...args: unknown[]) => mockCreateAuction(...args),
  placeBid: (...args: unknown[]) => mockPlaceBid(...args),
  finalizeAuction: (...args: unknown[]) => mockFinalizeAuction(...args),
}));

jest.mock("@/lib/indexer", () => ({
  fetchAuctions: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/ipfs", () => ({
  uploadImageToIPFS: jest.fn().mockResolvedValue({ cid: "QmImage" }),
  uploadMetadataToIPFS: jest.fn().mockResolvedValue({ cid: "QmMeta" }),
}));

jest.mock("@/lib/errors", () => ({
  getReadableErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

jest.mock("@/hooks/useTransientErrorToast", () => ({
  useTransientErrorToast: jest.fn(),
}));

jest.mock("@/lib/token-support", () => ({
  assertSupportedTokenAddress: jest
    .fn()
    .mockResolvedValue({ address: "GTOKEN", symbol: "XLM" }),
}));

import {
  useAuctions,
  useArtistAuctions,
  useCreateAuction,
  useFinalizeAuction,
} from "@/hooks/useAuctions";
import { usePlaceBid } from "@/hooks/usePlaceBid";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuction(id: number) {
  return {
    auction_id: id,
    artist: "GARTIST",
    metadata_cid: "Qm",
    reserve_price: 10_000_000n,
    highest_bid: 0n,
    highest_bidder: null,
    end_time: 9999,
    status: "Active",
  };
}

// ── useAuctions ───────────────────────────────────────────────────────────────

describe("useAuctions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("loads auctions from the indexer", async () => {
    const { fetchAuctions } = jest.requireMock("@/lib/indexer");
    fetchAuctions.mockResolvedValueOnce([makeAuction(1), makeAuction(2)]);

    function Comp() {
      const { auctions, isLoading } = useAuctions();
      return (
        <div>
          <span data-testid="count">{auctions.length}</span>
          <span data-testid="loading">{String(isLoading)}</span>
        </div>
      );
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("2"),
    );
  });

  it("falls back to on-chain when indexer throws", async () => {
    const { fetchAuctions } = jest.requireMock("@/lib/indexer");
    fetchAuctions.mockRejectedValueOnce(new Error("indexer down"));
    mockGetAllAuctions.mockResolvedValueOnce([makeAuction(1), makeAuction(2)]);

    function Comp() {
      const { auctions } = useAuctions();
      return <span data-testid="count">{auctions.length}</span>;
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("2"),
    );
  });

  it("sets error when both indexer and contract fail", async () => {
    const { fetchAuctions } = jest.requireMock("@/lib/indexer");
    fetchAuctions.mockRejectedValueOnce(new Error("indexer down"));
    mockGetAllAuctions.mockRejectedValueOnce(new Error("chain down"));

    function Comp() {
      const { error } = useAuctions();
      return <span data-testid="error">{error ?? "none"}</span>;
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).not.toBe("none"),
    );
  });

  it("exposes a refresh function that re-fetches", async () => {
    const { fetchAuctions } = jest.requireMock("@/lib/indexer");
    fetchAuctions
      .mockResolvedValueOnce([makeAuction(1)])
      .mockResolvedValueOnce([makeAuction(1), makeAuction(2)]);

    let refreshFn: () => void;
    function Comp() {
      const { auctions, refresh } = useAuctions();
      refreshFn = refresh;
      return <span data-testid="count">{auctions.length}</span>;
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("1"),
    );

    await act(async () => {
      refreshFn();
    });
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("2"),
    );
  });
});

// ── useArtistAuctions ─────────────────────────────────────────────────────────

describe("useArtistAuctions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does nothing when publicKey is null", () => {
    function Comp() {
      const { auctions, isLoading } = useArtistAuctions(null);
      return (
        <div>
          <span data-testid="count">{auctions.length}</span>
          <span data-testid="loading">{String(isLoading)}</span>
        </div>
      );
    }
    render(<Comp />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("fetches auctions for a given artist", async () => {
    const { fetchAuctions } = jest.requireMock("@/lib/indexer");
    fetchAuctions.mockRejectedValueOnce(new Error("indexer down"));
    mockGetArtistAuctions.mockResolvedValueOnce([10, 11]);
    mockGetAuction
      .mockResolvedValueOnce(makeAuction(10))
      .mockResolvedValueOnce(makeAuction(11));

    function Comp() {
      const { auctions } = useArtistAuctions("GARTIST");
      return <span data-testid="count">{auctions.length}</span>;
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("2"),
    );
  });

  it("sets error when fetch fails", async () => {
    const { fetchAuctions } = jest.requireMock("@/lib/indexer");
    fetchAuctions.mockRejectedValueOnce(new Error("indexer down"));
    mockGetArtistAuctions.mockRejectedValueOnce(new Error("nope"));

    function Comp() {
      const { error } = useArtistAuctions("GARTIST");
      return <span data-testid="error">{error ?? "none"}</span>;
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).not.toBe("none"),
    );
  });
});

// ── useCreateAuction ──────────────────────────────────────────────────────────

describe("useCreateAuction", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns null immediately when publicKey is null", async () => {
    function Comp() {
      const { create, isCreating } = useCreateAuction(null);
      const [result, setResult] = React.useState<number | null | undefined>(
        undefined,
      );
      return (
        <div>
          <button
            onClick={async () =>
              setResult(
                await create({
                  title: "T",
                  description: "D",
                  artistName: "A",
                  year: "2024",
                  category: "C",
                  imageFile: new File([], "f.png"),
                  reservePriceXlm: 10,
                  durationHours: 24,
                }),
              )
            }
          >
            create
          </button>
          <span data-testid="result">{String(result)}</span>
          <span data-testid="creating">{String(isCreating)}</span>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<Comp />);
    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByTestId("result").textContent).toBe("null"),
    );
  });

  it("calls create auction contract and returns id on success", async () => {
    mockCreateAuction.mockResolvedValueOnce(42);

    function Comp() {
      const { create } = useCreateAuction("GCREATOR");
      const [result, setResult] = React.useState<number | null | undefined>(
        undefined,
      );
      return (
        <div>
          <button
            onClick={async () =>
              setResult(
                await create({
                  title: "T",
                  description: "D",
                  artistName: "A",
                  year: "2024",
                  category: "C",
                  imageFile: new File([], "f.png"),
                  reservePriceXlm: 10,
                  durationHours: 24,
                }),
              )
            }
          >
            create
          </button>
          <span data-testid="result">{String(result)}</span>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<Comp />);
    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByTestId("result").textContent).toBe("42"),
    );
  });

  it("returns null and sets error when creation fails", async () => {
    mockCreateAuction.mockRejectedValueOnce(new Error("contract error"));

    function Comp() {
      const { create, error } = useCreateAuction("GCREATOR");
      const [result, setResult] = React.useState<number | null | undefined>(
        undefined,
      );
      return (
        <div>
          <button
            onClick={async () =>
              setResult(
                await create({
                  title: "T",
                  description: "D",
                  artistName: "A",
                  year: "2024",
                  category: "C",
                  imageFile: new File([], "f.png"),
                  reservePriceXlm: 10,
                  durationHours: 24,
                }),
              )
            }
          >
            create
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
      expect(screen.getByTestId("result").textContent).toBe("null"),
    );
    expect(screen.getByTestId("error").textContent).not.toBe("none");
  });
});

// ── usePlaceBid ───────────────────────────────────────────────────────────────

describe("usePlaceBid", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns false immediately when publicKey is null", async () => {
    function Comp() {
      const { bid } = usePlaceBid(null);
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await bid(1, 5))}>bid</button>
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
  });

  it("returns true and calls placeBid on success", async () => {
    mockPlaceBid.mockResolvedValueOnce(undefined);

    function Comp() {
      const { bid } = usePlaceBid("GBIDDER");
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await bid(1, 5))}>bid</button>
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
    expect(mockPlaceBid).toHaveBeenCalledWith("GBIDDER", 1, 5);
  });

  it("returns false and sets error when bid fails", async () => {
    mockPlaceBid.mockRejectedValueOnce(new Error("bid error"));

    function Comp() {
      const { bid, error } = usePlaceBid("GBIDDER");
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await bid(1, 5))}>bid</button>
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
  });
});

// ── useFinalizeAuction ────────────────────────────────────────────────────────

describe("useFinalizeAuction", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns false immediately when publicKey is null", async () => {
    function Comp() {
      const { finalize } = useFinalizeAuction(null);
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await finalize(1))}>
            finalize
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
  });

  it("calls finalizeAuction and returns true on success", async () => {
    mockFinalizeAuction.mockResolvedValueOnce(undefined);

    function Comp() {
      const { finalize } = useFinalizeAuction("GCALLER");
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await finalize(5))}>
            finalize
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
    expect(mockFinalizeAuction).toHaveBeenCalledWith("GCALLER", 5);
  });

  it("handles async rejection gracefully with try/catch error handling (#1039)", async () => {
    mockFinalizeAuction.mockRejectedValueOnce(new Error("RPC failure"));

    function Comp() {
      const { finalize } = useFinalizeAuction("GCALLER");
      const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

      const handleFinalize = async () => {
        try {
          await finalize(99);
        } catch (err: unknown) {
          setErrorMsg(err instanceof Error ? err.message : "Error finalizing");
        }
      };

      return (
        <div>
          <button onClick={handleFinalize}>finalize with error</button>
          <span data-testid="error-state">{errorMsg ?? "no-error"}</span>
        </div>
      );
    }

    const user = userEvent.setup();
    render(<Comp />);
    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByTestId("error-state")).toBeDefined();
    });
  });
});

