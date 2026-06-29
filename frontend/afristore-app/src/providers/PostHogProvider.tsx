"use client";

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

if (typeof window !== "undefined") {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  if (posthogKey && posthogKey !== "phc_placeholder") {
    posthog.init(posthogKey, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: false, // We handle this manually
      capture_pageleave: true,
      autocapture: false, // We'll capture custom events manually for better control
    });
  }
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname && posthog.__loaded) {
      let url = window.origin + pathname;
      if (searchParams && searchParams.toString()) {
        url = url + `?${searchParams.toString()}`;
      }
      posthog.capture("$pageview", {
        $current_url: url,
      });
    }
  }, [pathname, searchParams]);

  return null;
}

export function CSPostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PostHogProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PostHogProvider>
  );
}

// Helper functions for custom event tracking
export const trackEvent = {
  walletConnected: (walletType: "freighter" | "magic", publicKey: string) => {
    if (posthog.__loaded) {
      posthog.capture("Wallet Connected", {
        wallet_type: walletType,
        public_key_prefix: publicKey.slice(0, 8),
      });
    }
  },

  listingCreated: (listingId: number, price: string, currency: string) => {
    if (posthog.__loaded) {
      posthog.capture("Listing Created", {
        listing_id: listingId,
        price,
        currency,
      });
    }
  },

  purchaseSuccessful: (listingId: number, price: string, currency: string) => {
    if (posthog.__loaded) {
      posthog.capture("Purchase Successful", {
        listing_id: listingId,
        price,
        currency,
      });
    }
  },

  walletConnectionDropOff: (
    step: "modal_opened" | "wallet_selected" | "connection_failed",
    walletType?: string,
  ) => {
    if (posthog.__loaded) {
      posthog.capture("Wallet Connection Drop-off", {
        step,
        wallet_type: walletType,
      });
    }
  },

  auctionBidPlaced: (auctionId: number, bidAmount: string) => {
    if (posthog.__loaded) {
      posthog.capture("Auction Bid Placed", {
        auction_id: auctionId,
        bid_amount: bidAmount,
      });
    }
  },

  collectionCreated: (collectionAddress: string, name: string) => {
    if (posthog.__loaded) {
      posthog.capture("Collection Created", {
        collection_address: collectionAddress,
        collection_name: name,
      });
    }
  },

  stakedNFT: (
    nftId: string,
    collectionAddress: string,
    amount: string,
  ) => {
    if (posthog.__loaded) {
      posthog.capture("NFT Staked", {
        nft_id: nftId,
        collection_address: collectionAddress,
        amount,
      });
    }
  },

  unstakedNFT: (
    nftId: string,
    collectionAddress: string,
    amount: string,
  ) => {
    if (posthog.__loaded) {
      posthog.capture("NFT Unstaked", {
        nft_id: nftId,
        collection_address: collectionAddress,
        amount,
      });
    }
  },

  claimedRewards: (
    collectionAddress: string,
    rewardAmount: string,
  ) => {
    if (posthog.__loaded) {
      posthog.capture("Rewards Claimed", {
        collection_address: collectionAddress,
        reward_amount: rewardAmount,
      });
    }
  },
};
