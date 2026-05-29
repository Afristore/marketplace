-- AlterTable Listing
ALTER TABLE "Listing" ADD COLUMN "originalCreator" TEXT;
ALTER TABLE "Listing" ADD COLUMN "recipients" JSONB;

-- CreateTable Auction
CREATE TABLE "Auction" (
    "auctionId" BIGINT NOT NULL PRIMARY KEY,
    "creator" TEXT NOT NULL,
    "metadataCid" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "reservePrice" DECIMAL(32, 7) NOT NULL,
    "highestBid" DECIMAL(32, 7) NOT NULL,
    "highestBidder" TEXT,
    "endTime" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "recipients" JSONB,
    "royaltyBps" INTEGER NOT NULL DEFAULT 0,
    "originalCreator" TEXT NOT NULL,
    "createdAtLedger" INTEGER NOT NULL,
    "updatedAtLedger" INTEGER NOT NULL
);

-- CreateTable Offer
CREATE TABLE "Offer" (
    "offerId" BIGINT NOT NULL PRIMARY KEY,
    "listingId" BIGINT NOT NULL,
    "offerer" TEXT NOT NULL,
    "amount" DECIMAL(32, 7) NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAtLedger" INTEGER NOT NULL,
    "updatedAtLedger" INTEGER NOT NULL
);
