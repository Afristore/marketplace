import { NextResponse } from "next/server";

const INDEXER_URL = (
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${INDEXER_URL}/wallets/${address}/activity?limit=20`);
    if (!res.ok) {
      return NextResponse.json(
        { notifications: [], unread_count: 0 },
        { status: 200 },
      );
    }

    const events = await res.json();
    const notifications = events.map((event: any) => {
      const { eventType, ledgerTimestamp, data, id } = event;
      const timestamp = new Date(ledgerTimestamp).getTime();
      let type = "SALE";
      let title = "Activity Event";
      let message = "A new activity event occurred.";
      let link = "/";

      const isActor = event.actor === address;

      if (eventType === "OFFER_CREATED") {
        type = "OFFER_RECEIVED";
        if (data.artist === address) {
          title = "New Offer Received";
          message = "You received a new offer on your NFT";
          link = "/offers/incoming";
        } else {
          title = "Offer Placed";
          message = "Your offer has been submitted successfully";
          link = "/offers";
        }
      } else if (eventType === "OFFER_ACCEPTED") {
        type = "OFFER_ACCEPTED";
        if (data.artist === address) {
          title = "Offer Accepted";
          message = "You accepted an offer on your NFT";
          link = "/profile";
        } else {
          title = "Offer Accepted!";
          message = "Your offer has been accepted by the artist";
          link = "/profile";
        }
      } else if (eventType === "OFFER_REJECTED") {
        type = "OFFER_REJECTED";
        title = "Offer Declined";
        message = "Your offer was declined by the artist";
        link = "/offers";
      } else if (eventType === "ARTWORK_SOLD") {
        if (data.artist === address) {
          type = "SALE";
          title = "Artwork Sold!";
          message = "Your NFT has been sold";
          link = "/profile";
        } else {
          type = "PURCHASE";
          title = "Artwork Purchased!";
          message = "You successfully purchased the NFT";
          link = "/profile";
        }
      } else if (eventType === "AUCTION_BID") {
        type = "AUCTION_OUTBID";
        if (data.bidder === address) {
          title = "Bid Placed";
          message = "Your bid was successfully placed";
          link = `/auctions/${event.auctionId || ""}`;
        } else {
          title = "New Bid Placed";
          message = "A new bid was placed on the auction";
          link = `/auctions/${event.auctionId || ""}`;
        }
      } else if (eventType === "AUCTION_FINALIZED") {
        type = "AUCTION_WON";
        if (data.winner === address) {
          title = "Auction Won!";
          message = "You successfully won the auction";
          link = "/profile";
        } else {
          title = "Auction Ended";
          message = "The auction has ended";
          link = "/auctions";
        }
      } else if (eventType === "LISTING_CREATED") {
        type = "SALE";
        title = "Listing Created";
        message = "Your NFT has been listed for sale";
        link = `/listings/${event.listingId || ""}`;
      }

      return {
        id: id || `evt_${timestamp}_${Math.random().toString(36).substring(2, 7)}`,
        type,
        title,
        message,
        timestamp,
        read: false,
        link,
      };
    });

    const unreadCount = notifications.filter((n: any) => !n.read).length;

    return NextResponse.json({
      notifications,
      unread_count: unreadCount,
    });
  } catch (err) {
    console.error("Failed to fetch historical notifications in API route:", err);
    return NextResponse.json(
      { notifications: [], unread_count: 0 },
      { status: 200 },
    );
  }
}
