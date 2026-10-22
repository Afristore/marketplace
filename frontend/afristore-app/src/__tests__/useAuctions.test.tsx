/**
 * Unit tests for useAuctions.ts hooks:
 * - useAuctions
 * - useArtistAuctions
 * - useCreateAuction
 * - usePlaceBid
 * - useFinalizeAuction
 *
 * Error handling contract covered here (issue #1039):
 *   • every async interaction is awaited inside a try/catch, in the test
 *     bodies as well as in the components' event handlers, so a rejected
 *     contract or indexer call can never escape as an unhandled promise
 *     rejection and take the React tree down;
 *   • a failure is surfaced to the user through the hook's `error` state
 *     and never silently swallowed: the tests assert the message, not just
 *     that something happened;
 *   • a global `unhandledRejection` listener fails the suite if any promise
 *     is ever left unhandled.
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
const mockUploadImageToIPFS = jest.fn();
const mockUploadMetadataToIPFS = jest.fn();
const mockAssertSupportedTokenAddress = jest.fn();

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
  uploadImageToIPFS: (...args: unknown[]) => mockUploadImageToIPFS(...args),
  uploadMetadataToIPFS: (...args: unknown[]) => mockUploadMetadataToIPFS(...args),
}));

// Mirrors the real implementation: an `Error` (or a string) is reported
// with its own message, anything else falls back to the message the hook
// passes in.
jest.mock("@/lib/errors", () => ({
  getReadableErrorMessage: (e: unknown, fallback: string) => {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    return fallback;
  },
}));

jest.mock("@/hooks/useTransientErrorToast", () => ({
  useTransientErrorToast: jest.fn(),
}));

jest.mock("@/lib/token-support", () => ({
  assertSupportedTokenAddress: (...args: unknown[]) =>
    mockAssertSupportedTokenAddress(...args),
}));

import {
  useAuctions,
  useArtistAuctions,
  useCreateAuction,
  useFinalizeAuction,
} from "@/hooks/useAuctions";
import { usePlaceBid } from "@/hooks/usePlaceBid";

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
});

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

function makeCreateInput() {
  return {
    title: "T",
    description: "D",
    artistName: "A",
    year: "2024",
    category: "C",
    imageFile: new File([], "f.png"),
    reservePriceXlm: 10,
    durationHours: 24,
  };
}

/** A component whose button calls `run` and reports what came back. */
function AsyncButton<T>({
  run,
  label,
}: {
  run: () => Promise<T>;
  label: string;
}) {
  const [result, setResult] = React.useState<T | undefined>(undefined);
  const [thrown, setThrown] = React.useState<string | null>(null);
  return (
    <div>
      <button
        onClick={async () => {
          try {
            setResult(await run());
          } catch (err) {
            setThrown(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        {label}
      </button>
      <span data-testid="result">{String(result)}</span>
      <span data-testid="thrown">{thrown ?? "none"}</span>
    </div>
  );
}

// ── useAuctions ───────────────────────────────────────────────────────────────

describe("useAuctions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadImageToIPFS.mockResolvedValue({ cid: "QmImage" });
    mockUploadMetadataToIPFS.mockResolvedValue({ cid: "QmMeta" });
    mockAssertSupportedTokenAddress.mockResolvedValue({
      address: "GTOKEN",
      symbol: "XLM",
    });
  });

  it("loads auctions from the indexer", async () => {
    try {
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
      expect(screen.getByTestId("loading").textContent).toBe("false");
    } catch (err) {
      throw err;
    }
  });

  it("falls back to on-chain when indexer throws", async () => {
    try {
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
    } catch (err) {
      throw err;
    }
  });

  it("sets the error message when both indexer and contract fail", async () => {
    try {
      const { fetchAuctions } = jest.requireMock("@/lib/indexer");
      fetchAuctions.mockRejectedValueOnce(new Error("indexer down"));
      mockGetAllAuctions.mockRejectedValueOnce(new Error("chain down"));

      function Comp() {
        const { error } = useAuctions();
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe("chain down"),
      );
    } catch (err) {
      throw err;
    }
  });

  it("falls back to a readable message when the failure is not an Error", async () => {
    try {
      const { fetchAuctions } = jest.requireMock("@/lib/indexer");
      fetchAuctions.mockRejectedValueOnce(new Error("indexer down"));
      mockGetAllAuctions.mockRejectedValueOnce({ code: 500 });

      function Comp() {
        const { error } = useAuctions();
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe(
          "Failed to load auctions",
        ),
      );
    } catch (err) {
      throw err;
    }
  });

  it("exposes a refresh function that re-fetches", async () => {
    try {
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
        try {
          await refreshFn();
        } catch (err) {
          throw err;
        }
      });
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("2"),
      );
    } catch (err) {
      throw err;
    }
  });

  it("clears the error after a successful refresh", async () => {
    try {
      const { fetchAuctions } = jest.requireMock("@/lib/indexer");
      fetchAuctions
        .mockRejectedValueOnce(new Error("indexer down"))
        .mockResolvedValueOnce([makeAuction(1)]);
      mockGetAllAuctions.mockRejectedValueOnce(new Error("chain down"));

      let refreshFn: () => void;
      function Comp() {
        const { error, refresh } = useAuctions();
        refreshFn = refresh;
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe("chain down"),
      );

      await act(async () => {
        try {
          await refreshFn();
        } catch (err) {
          throw err;
        }
      });
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe("none"),
      );
    } catch (err) {
      throw err;
    }
  });
});

// ── useArtistAuctions ─────────────────────────────────────────────────────────

describe("useArtistAuctions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadImageToIPFS.mockResolvedValue({ cid: "QmImage" });
    mockUploadMetadataToIPFS.mockResolvedValue({ cid: "QmMeta" });
    mockAssertSupportedTokenAddress.mockResolvedValue({
      address: "GTOKEN",
      symbol: "XLM",
    });
  });

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
    try {
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
    } catch (err) {
      throw err;
    }
  });

  it("sets the error message when the artist lookup fails", async () => {
    try {
      const { fetchAuctions } = jest.requireMock("@/lib/indexer");
      fetchAuctions.mockRejectedValueOnce(new Error("indexer down"));
      mockGetArtistAuctions.mockRejectedValueOnce(new Error("nope"));

      function Comp() {
        const { error } = useArtistAuctions("GARTIST");
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe("nope"),
      );
    } catch (err) {
      throw err;
    }
  });

  it("sets the error message when a single auction lookup fails", async () => {
    try {
      const { fetchAuctions } = jest.requireMock("@/lib/indexer");
      fetchAuctions.mockRejectedValueOnce(new Error("indexer down"));
      mockGetArtistAuctions.mockResolvedValueOnce([10, 11]);
      mockGetAuction
        .mockResolvedValueOnce(makeAuction(10))
        .mockRejectedValueOnce(new Error("auction 11 unavailable"));

      function Comp() {
        const { error } = useArtistAuctions("GARTIST");
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe(
          "auction 11 unavailable",
        ),
      );
    } catch (err) {
      throw err;
    }
  });
});

// ── useCreateAuction ──────────────────────────────────────────────────────────

describe("useCreateAuction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadImageToIPFS.mockResolvedValue({ cid: "QmImage" });
    mockUploadMetadataToIPFS.mockResolvedValue({ cid: "QmMeta" });
    mockAssertSupportedTokenAddress.mockResolvedValue({
      address: "GTOKEN",
      symbol: "XLM",
    });
  });

  it("returns null immediately when publicKey is null", async () => {
    try {
      function Comp() {
        const { create, error } = useCreateAuction(null);
        return (
          <AsyncButton
            label="create"
            run={async () => await create(makeCreateInput())}
          />
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("null"),
      );
      expect(screen.getByTestId("thrown").textContent).toBe("none");
    } catch (err) {
      throw err;
    }
  });

  it("calls create auction contract and returns id on success", async () => {
    try {
      mockCreateAuction.mockResolvedValueOnce(42);

      function Comp() {
        const { create } = useCreateAuction("GCREATOR");
        return (
          <AsyncButton
            label="create"
            run={async () => await create(makeCreateInput())}
          />
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("42"),
      );
      expect(screen.getByTestId("thrown").textContent).toBe("none");
      expect(mockCreateAuction).toHaveBeenCalled();
    } catch (err) {
      throw err;
    }
  });

  it("returns null and sets error when creation fails", async () => {
    try {
      mockCreateAuction.mockRejectedValueOnce(new Error("contract error"));

      function Comp() {
        const { create, error } = useCreateAuction("GCREATOR");
        return (
          <div>
            <AsyncButton
              label="create"
              run={async () => await create(makeCreateInput())}
            />
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
      expect(screen.getByTestId("error").textContent).toBe("contract error");
    } catch (err) {
      throw err;
    }
  });

  it("returns null and sets error when the image upload fails", async () => {
    try {
      mockUploadImageToIPFS.mockRejectedValueOnce(new Error("ipfs down"));

      function Comp() {
        const { create, error, isCreating } = useCreateAuction("GCREATOR");
        return (
          <div>
            <AsyncButton
              label="create"
              run={async () => await create(makeCreateInput())}
            />
            <span data-testid="error">{error ?? "none"}</span>
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
      expect(screen.getByTestId("error").textContent).toBe("ipfs down");
      expect(screen.getByTestId("creating").textContent).toBe("false");
      expect(mockCreateAuction).not.toHaveBeenCalled();
    } catch (err) {
      throw err;
    }
  });

  it("returns null and sets error when the token is not supported", async () => {
    try {
      mockAssertSupportedTokenAddress.mockRejectedValueOnce(
        new Error("token not supported"),
      );

      function Comp() {
        const { create, error } = useCreateAuction("GCREATOR");
        return (
          <div>
            <AsyncButton
              label="create"
              run={async () => await create(makeCreateInput())}
            />
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
      expect(screen.getByTestId("error").textContent).toBe("token not supported");
      expect(mockCreateAuction).not.toHaveBeenCalled();
    } catch (err) {
      throw err;
    }
  });
});

// ── usePlaceBid ───────────────────────────────────────────────────────────────

describe("usePlaceBid", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns false immediately when publicKey is null", async () => {
    try {
      function Comp() {
        const { bid, error } = usePlaceBid(null);
        return (
          <div>
            <AsyncButton label="bid" run={async () => await bid(1, 5)} />
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
      expect(screen.getByTestId("error").textContent).toBe(
        "Wallet not connected",
      );
    } catch (err) {
      throw err;
    }
  });

  it("returns true and calls placeBid on success", async () => {
    try {
      mockPlaceBid.mockResolvedValueOnce(undefined);

      function Comp() {
        const { bid } = usePlaceBid("GBIDDER");
        return <AsyncButton label="bid" run={async () => await bid(1, 5)} />;
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("true"),
      );
      expect(mockPlaceBid).toHaveBeenCalledWith("GBIDDER", 1, 5);
    } catch (err) {
      throw err;
    }
  });

  it("returns false and sets error when bid fails", async () => {
    try {
      mockPlaceBid.mockRejectedValueOnce(new Error("bid error"));

      function Comp() {
        const { bid, error } = usePlaceBid("GBIDDER");
        return (
          <div>
            <AsyncButton label="bid" run={async () => await bid(1, 5)} />
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
      expect(screen.getByTestId("error").textContent).toBe("bid error");
    } catch (err) {
      throw err;
    }
  });

  it("clears the error when a later bid succeeds", async () => {
    try {
      mockPlaceBid
        .mockRejectedValueOnce(new Error("bid error"))
        .mockResolvedValueOnce(undefined);

      function Comp() {
        const { bid, error } = usePlaceBid("GBIDDER");
        return (
          <div>
            <AsyncButton label="bid" run={async () => await bid(1, 5)} />
            <span data-testid="error">{error ?? "none"}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe("bid error"),
      );

      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("true"),
      );
      expect(screen.getByTestId("error").textContent).toBe("none");
    } catch (err) {
      throw err;
    }
  });
});

// ── useFinalizeAuction ────────────────────────────────────────────────────────

describe("useFinalizeAuction", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns false immediately when publicKey is null", async () => {
    try {
      function Comp() {
        const { finalize, error } = useFinalizeAuction(null);
        return (
          <div>
            <AsyncButton label="finalize" run={async () => await finalize(1)} />
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
      expect(screen.getByTestId("error").textContent).toBe(
        "Wallet not connected",
      );
    } catch (err) {
      throw err;
    }
  });

  it("calls finalizeAuction and returns true on success", async () => {
    try {
      mockFinalizeAuction.mockResolvedValueOnce(undefined);

      function Comp() {
        const { finalize } = useFinalizeAuction("GCALLER");
        return (
          <AsyncButton label="finalize" run={async () => await finalize(5)} />
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("true"),
      );
      expect(mockFinalizeAuction).toHaveBeenCalledWith("GCALLER", 5);
    } catch (err) {
      throw err;
    }
  });

  it("returns false and sets error when finalization fails", async () => {
    try {
      mockFinalizeAuction.mockRejectedValueOnce(new Error("finalize error"));

      function Comp() {
        const { finalize, error, isFinalizing } = useFinalizeAuction("GCALLER");
        return (
          <div>
            <AsyncButton label="finalize" run={async () => await finalize(5)} />
            <span data-testid="error">{error ?? "none"}</span>
            <span data-testid="finalizing">{String(isFinalizing)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("false"),
      );
      expect(screen.getByTestId("error").textContent).toBe("finalize error");
      expect(screen.getByTestId("finalizing").textContent).toBe("false");
    } catch (err) {
      throw err;
    }
  });
});
