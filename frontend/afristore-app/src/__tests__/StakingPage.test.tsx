/**
 * Unit tests for StakingPage partial staking error handling.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockStake = jest.fn();
const mockTotalStaked = jest.fn().mockResolvedValue(5);
const mockRefreshNFTs = jest.fn().mockResolvedValue(undefined);

let mockTokens = [
  {
    collectionAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    tokenId: 1,
    name: "NFT #1",
  },
  {
    collectionAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    tokenId: 2,
    name: "NFT #2",
  },
  {
    collectionAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    tokenId: 3,
    name: "NFT #3",
  },
];

const mockSearchParams = {
  get: (key: string) =>
    key === "collection"
      ? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
      : null,
};

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    publicKey: "GCREATOR123",
    isConnected: true,
    isConnecting: false,
  }),
}));

jest.mock("@/hooks/useOwnedNFTs", () => ({
  useOwnedNFTs: () => ({
    tokens: mockTokens,
    isLoading: false,
    refresh: mockRefreshNFTs,
  }),
}));

jest.mock("@/lib/launchpad", () => ({
  getStakingPoolByNft: jest.fn().mockResolvedValue("CPOOL12345678901234567890123456789012345678901234567890123456"),
}));

jest.mock("@/lib/staking", () => ({
  calculateRewards: jest.fn().mockResolvedValue(0),
  estimateApyPercent: jest.fn().mockReturnValue("12%"),
  formatRewardRatePerDay: jest.fn().mockReturnValue("10 tokens"),
  formatAnnualYieldPerNft: jest.fn().mockReturnValue("3650 tokens"),
  getStakingPoolConfig: jest.fn().mockResolvedValue({
    rewardToken: "CREWARDTOKEN",
    rewardRate: 10000000n,
    minDuration: 0,
    maxDuration: 0,
  }),
  totalStaked: (...args: unknown[]) => mockTotalStaked(...args),
  stake: (...args: unknown[]) => mockStake(...args),
  unstake: jest.fn().mockResolvedValue(undefined),
  claimRewards: jest.fn().mockResolvedValue(undefined),
  getUserStakes: jest.fn().mockResolvedValue([]),
}));

jest.mock("lucide-react", () =>
  Object.fromEntries(
    [
      "AlertCircle",
      "CheckCircle",
      "Lock",
      "Unlock",
      "Coins",
      "Wallet",
      "Layers",
      "Search",
      "Loader2",
      "Settings",
      "TrendingUp",
    ].map((name) => [name, () => <span />]),
  ),
);

import StakingPage from "@/app/staking/page";

describe("StakingPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);
  });

  it("removes successfully staked tokens from selection and notifies on partial failure", async () => {
    const user = userEvent.setup();

    // 1st stake succeeds, 2nd succeeds, 3rd fails/rejected
    mockStake
      .mockResolvedValueOnce(undefined) // Token 1
      .mockResolvedValueOnce(undefined) // Token 2
      .mockRejectedValueOnce(new Error("User rejected transaction signature")); // Token 3

    render(<StakingPage />);

    // Wait for pool to load
    await waitFor(() => {
      expect(screen.getByText("NFT #1")).toBeInTheDocument();
    });

    // Select all 3 NFTs
    await user.click(screen.getByText("NFT #1"));
    await user.click(screen.getByText("NFT #2"));
    await user.click(screen.getByText("NFT #3"));

    expect(screen.getByText("3 NFTs selected")).toBeInTheDocument();

    // Click Stake Selected
    await user.click(screen.getByRole("button", { name: /stake selected/i }));

    // Verify partial failure message notifies user
    await waitFor(() => {
      expect(
        screen.getByText(/partially succeeded: staked 2 of 3 nfts/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/user rejected transaction signature/i)).toBeInTheDocument();

    // Tokens 1 & 2 were removed from selectedIds as they succeeded, only token 3 remains selected
    expect(screen.getByText("1 NFT selected")).toBeInTheDocument();

    // Verifies data refreshed on partial success
    expect(mockRefreshNFTs).toHaveBeenCalled();
  });
});
