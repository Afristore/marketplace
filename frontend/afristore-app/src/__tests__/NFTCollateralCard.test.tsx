/**
 * Component tests for NFTCollateralCard.
 * External dependencies (Next Image, IPFS resolver) are mocked so the
 * suite runs deterministically without network access.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NFTCollateralCard } from "@/components/lending/NFTCollateralCard";
import type { LendingOffer } from "@/components/lending/types";

// ── Mocks ─────────────────────────────────────────────────────

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    const {
      fill: _fill,
      unoptimized: _unoptimized,
      priority: _priority,
      quality: _quality,
      alt,
      ...rest
    } = props;
    return <img alt={alt || ""} {...rest} />;
  },
}));

const mockCidToGatewayUrl = jest.fn((cid: string) => cid);

jest.mock("@/lib/ipfs", () => ({
  cidToGatewayUrl: (cid: string) => mockCidToGatewayUrl(cid),
}));

// ── Helpers ───────────────────────────────────────────────────

function makeOffer(overrides: Partial<LendingOffer> = {}): LendingOffer {
  return {
    id: 7,
    lender: "GLENDER123",
    nft_contract: "CCOLLECTIONCONTRACT123456789",
    token_id: 42,
    declared_price_usd: 100_000_000n, // $10.00
    interest_schedule_bps: [500, 1000],
    max_duration_days: 30,
    min_collateral_buffer_bps: 12000, // 120% => $12.00 collateral
    liquidation_threshold_bps: 11000, // 110%
    status: "Open",
    created_at: 0,
    ...overrides,
  };
}

describe("NFTCollateralCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCidToGatewayUrl.mockImplementation((cid: string) =>
      cid.replace("ipfs://", "https://gateway.example/ipfs/"),
    );
  });

  it("renders the NFT name, required collateral and duration", () => {
    render(
      <NFTCollateralCard
        listing={makeOffer({ nftName: "Savanna Mask" })}
      />,
    );

    expect(screen.getByText("Savanna Mask")).toBeInTheDocument();
    // Collateral = $10.00 * 120% = $12.00
    expect(screen.getByText("$12.00")).toBeInTheDocument();
    expect(screen.getByText("Up to 30 days")).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument(); // loan amount
  });

  it("falls back to the token id when no NFT name is provided", () => {
    render(<NFTCollateralCard listing={makeOffer({ nftName: undefined })} />);
    expect(screen.getByText("Token #42")).toBeInTheDocument();
  });

  it("resolves raw IPFS URIs to a gateway URL for the card image", () => {
    render(
      <NFTCollateralCard
        listing={makeOffer({
          nftImage: "ipfs://QmImageCid123",
        })}
      />,
    );

    const img = screen.getByAltText("Savanna Mask") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe(
      "https://gateway.example/ipfs/QmImageCid123",
    );
    expect(mockCidToGatewayUrl).toHaveBeenCalledWith("ipfs://QmImageCid123");
  });

  it("renders a placeholder when the NFT has no image", () => {
    const { container } = render(
      <NFTCollateralCard listing={makeOffer({ nftImage: undefined })} />,
    );
    // No <img> should be rendered when there is nothing to show.
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a clear call-to-action and invokes onBorrow with the listing", () => {
    const onBorrow = jest.fn();
    const listing = makeOffer({ id: 9 });

    render(
      <NFTCollateralCard listing={listing} onBorrow={onBorrow} />,
    );

    const cta = screen.getByTestId("borrow-cta-9");
    expect(
      screen.getByRole("button", { name: /Borrow against this NFT/i }),
    ).toBeInTheDocument();

    fireEvent.click(cta);
    expect(onBorrow).toHaveBeenCalledWith(listing);
  });

  it("disables the CTA while a borrow transaction is in flight", () => {
    const onBorrow = jest.fn();
    render(
      <NFTCollateralCard
        listing={makeOffer({ id: 10 })}
        onBorrow={onBorrow}
        isBorrowing={true}
      />,
    );

    const cta = screen.getByTestId("borrow-cta-10");
    expect(cta).toBeDisabled();
    expect(screen.getByText(/Borrowing\.\.\./)).toBeInTheDocument();
  });
});