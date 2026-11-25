/**
 * Unit tests for useOffers.ts hooks.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetOffer = jest.fn();
const mockGetOffererOffers = jest.fn();
const mockGetListingOffers = jest.fn();
const mockGetArtistListings = jest.fn();
const mockGetListing = jest.fn();
const mockWithdrawOffer = jest.fn();
const mockAcceptOffer = jest.fn();
const mockRejectOffer = jest.fn();
const mockMakeOffer = jest.fn();

jest.mock("@/lib/contract", () => ({
  getOffer: (...args: unknown[]) => mockGetOffer(...args),
  getOffererOffers: (...args: unknown[]) => mockGetOffererOffers(...args),
  getListingOffers: (...args: unknown[]) => mockGetListingOffers(...args),
  getArtistListings: (...args: unknown[]) => mockGetArtistListings(...args),
  getListing: (...args: unknown[]) => mockGetListing(...args),
  withdrawOffer: (...args: unknown[]) => mockWithdrawOffer(...args),
  acceptOffer: (...args: unknown[]) => mockAcceptOffer(...args),
  rejectOffer: (...args: unknown[]) => mockRejectOffer(...args),
  makeOffer: (...args: unknown[]) => mockMakeOffer(...args),
}));

jest.mock("@/lib/errors", () => ({
  getReadableErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

jest.mock("@/hooks/useTransientErrorToast", () => ({
  useTransientErrorToast: jest.fn(),
}));

import {
  useOffererOffers,
  useListingOffers,
  useIncomingOffers,
  useWithdrawOffer,
  useAcceptOffer,
  useRejectOffer,
  useMakeOffer,
} from "@/hooks/useOffers";

function makeOffer(id: number) {
  return {
    offer_id: id,
    listing_id: 1,
    offerer: "GOFFERER",
    amount: 5_000_000n,
    token: "CTOKEN",
    status: "Pending",
    created_at: 1000,
  };
}

function makeListing(id: number) {
  return {
    listing_id: id,
    artist: "GARTIST",
    status: "Active",
    price: 10_000_000n,
    metadata_cid: "Qm",
  };
}

// ── useOffererOffers ──────────────────────────────────────────────────────────

describe("useOffererOffers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does nothing when publicKey is null", () => {
    function Comp() {
      const { offers, isLoading } = useOffererOffers(null);
      return (
        <div>
          <span data-testid="count">{offers.length}</span>
          <span data-testid="loading">{String(isLoading)}</span>
        </div>
      );
    }
    render(<Comp />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("loads and enriches offers with listing data", async () => {
    mockGetOffererOffers.mockResolvedValueOnce([10, 11]);
    mockGetOffer
      .mockResolvedValueOnce(makeOffer(10))
      .mockResolvedValueOnce(makeOffer(11));
    mockGetListing.mockResolvedValue(makeListing(1));

    function Comp() {
      const { offers } = useOffererOffers("GOFFERER");
      return <span data-testid="count">{offers.length}</span>;
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("2"),
    );
  });

  it("sets error when fetch fails", async () => {
    mockGetOffererOffers.mockRejectedValueOnce(new Error("fail"));

    function Comp() {
      const { error } = useOffererOffers("GOFFERER");
      return <span data-testid="error">{error ?? "none"}</span>;
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).not.toBe("none"),
    );
  });
});

// ── useListingOffers ──────────────────────────────────────────────────────────

describe("useListingOffers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does nothing when listingId is null", () => {
    function Comp() {
      const { offers, isLoading } = useListingOffers(null);
      return (
        <div>
          <span data-testid="count">{offers.length}</span>
          <span data-testid="loading">{String(isLoading)}</span>
        </div>
      );
    }
    render(<Comp />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("fetches offers for a listing", async () => {
    mockGetListingOffers.mockResolvedValueOnce([5, 6]);
    mockGetOffer
      .mockResolvedValueOnce(makeOffer(5))
      .mockResolvedValueOnce(makeOffer(6));

    function Comp() {
      const { offers } = useListingOffers(1);
      return <span data-testid="count">{offers.length}</span>;
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("2"),
    );
  });
});

// ── useIncomingOffers ─────────────────────────────────────────────────────────

describe("useIncomingOffers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does nothing when ownerPublicKey is null", () => {
    function Comp() {
      const { offersByListing } = useIncomingOffers(null);
      return <span data-testid="count">{offersByListing.length}</span>;
    }
    render(<Comp />);
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("fetches offers for all active listings of the owner", async () => {
    mockGetArtistListings.mockResolvedValueOnce([1]);
    mockGetListing.mockResolvedValueOnce(makeListing(1));
    mockGetListingOffers.mockResolvedValueOnce([7]);
    mockGetOffer.mockResolvedValueOnce(makeOffer(7));

    function Comp() {
      const { offersByListing } = useIncomingOffers("GOWNER");
      return <span data-testid="count">{offersByListing.length}</span>;
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("1"),
    );
  });

  it("sorts pending offers first within each listing group and prioritizes pending groups", async () => {
    mockGetArtistListings.mockResolvedValueOnce([1, 2]);
    mockGetListing
      .mockResolvedValueOnce(makeListing(1))
      .mockResolvedValueOnce(makeListing(2));

    mockGetListingOffers
      .mockResolvedValueOnce([10])
      .mockResolvedValueOnce([20, 21]);

    mockGetOffer
      .mockResolvedValueOnce({
        ...makeOffer(10),
        status: "Rejected",
        created_at: 100,
      })
      .mockResolvedValueOnce({
        ...makeOffer(20),
        status: "Accepted",
        created_at: 200,
      })
      .mockResolvedValueOnce({
        ...makeOffer(21),
        status: "Pending",
        created_at: 150,
      });

    function Comp() {
      const { offersByListing } = useIncomingOffers("GOWNER");
      return (
        <div>
          <span data-testid="count">{offersByListing.length}</span>
          <span data-testid="first-listing">
            {offersByListing[0]?.listing.listing_id}
          </span>
          <span data-testid="first-offer-status">
            {offersByListing[0]?.offers[0]?.status}
          </span>
        </div>
      );
    }
    render(<Comp />);
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("2"),
    );
    expect(screen.getByTestId("first-listing").textContent).toBe("2");
    expect(screen.getByTestId("first-offer-status").textContent).toBe("Pending");
  });
});

// ── useWithdrawOffer ──────────────────────────────────────────────────────────

describe("useWithdrawOffer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns false when publicKey is null", async () => {
    function Comp() {
      const { withdraw } = useWithdrawOffer(null);
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await withdraw(1))}>w</button>
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

  it("calls withdrawOffer and returns true on success", async () => {
    mockWithdrawOffer.mockResolvedValueOnce(undefined);

    function Comp() {
      const { withdraw } = useWithdrawOffer("GPUBLICKEY");
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await withdraw(3))}>w</button>
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
    expect(mockWithdrawOffer).toHaveBeenCalledWith("GPUBLICKEY", 3);
  });
});

// ── useAcceptOffer ────────────────────────────────────────────────────────────

describe("useAcceptOffer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns false when publicKey is null", async () => {
    function Comp() {
      const { accept } = useAcceptOffer(null);
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await accept(1))}>a</button>
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

  it("calls acceptOffer and returns true on success", async () => {
    mockAcceptOffer.mockResolvedValueOnce(undefined);

    function Comp() {
      const { accept } = useAcceptOffer("GARTIST");
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await accept(5))}>a</button>
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
    expect(mockAcceptOffer).toHaveBeenCalledWith("GARTIST", 5);
  });
});

// ── useRejectOffer ────────────────────────────────────────────────────────────

describe("useRejectOffer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls rejectOffer and returns true on success", async () => {
    mockRejectOffer.mockResolvedValueOnce(undefined);

    function Comp() {
      const { reject } = useRejectOffer("GARTIST");
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await reject(8))}>r</button>
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
    expect(mockRejectOffer).toHaveBeenCalledWith("GARTIST", 8);
  });

  it("sets error and returns false on failure", async () => {
    mockRejectOffer.mockRejectedValueOnce(new Error("reject failed"));

    function Comp() {
      const { reject, error } = useRejectOffer("GARTIST");
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await reject(8))}>r</button>
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

// ── useMakeOffer ──────────────────────────────────────────────────────────────

describe("useMakeOffer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns false when publicKey is null", async () => {
    function Comp() {
      const { make } = useMakeOffer(null);
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await make(1, 5, "CTOKEN"))}>
            m
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

  it("calls makeOffer and returns true on success", async () => {
    mockMakeOffer.mockResolvedValueOnce(undefined);

    function Comp() {
      const { make } = useMakeOffer("GBIDDER");
      const [result, setResult] = React.useState<boolean | undefined>(
        undefined,
      );
      return (
        <div>
          <button onClick={async () => setResult(await make(2, 3, "CTOKEN"))}>
            m
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
    expect(mockMakeOffer).toHaveBeenCalledWith("GBIDDER", 2, 3, "CTOKEN");
  });
});
