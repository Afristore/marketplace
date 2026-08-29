-- CreateEnum
CREATE TYPE "LendingPositionStatus" AS ENUM ('Active', 'Repaid', 'Liquidated', 'Returned', 'Expired');

-- CreateTable
CREATE TABLE "LendingListing" (
    "id" BIGINT NOT NULL,
    "lender" TEXT NOT NULL,
    "nftContract" TEXT NOT NULL,
    "collectionAddress" TEXT,
    "tokenId" BIGINT NOT NULL,
    "declaredPriceUsd" DECIMAL(32,7) NOT NULL,
    "interestScheduleBps" JSONB NOT NULL,
    "maxDurationDays" INTEGER NOT NULL,
    "minCollateralBufferBps" INTEGER NOT NULL,
    "liquidationThresholdBps" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAtLedger" INTEGER NOT NULL,
    "updatedAtLedger" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LendingListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LendingPosition" (
    "id" BIGINT NOT NULL,
    "listingId" BIGINT NOT NULL,
    "lender" TEXT NOT NULL,
    "borrower" TEXT NOT NULL,
    "nftContract" TEXT NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "declaredPriceUsd" DECIMAL(32,7) NOT NULL,
    "collateralCurrency" TEXT NOT NULL,
    "collateralAmount" DECIMAL(32,7) NOT NULL,
    "interestScheduleBps" JSONB NOT NULL,
    "liquidationThresholdBps" INTEGER NOT NULL,
    "startTime" BIGINT NOT NULL,
    "maxDurationSecs" BIGINT NOT NULL,
    "status" "LendingPositionStatus" NOT NULL DEFAULT 'Active',
    "liquidator" TEXT,
    "liquidatorBounty" DECIMAL(32,7),
    "lenderPayout" DECIMAL(32,7),
    "platformFee" DECIMAL(32,7),
    "borrowerRefund" DECIMAL(32,7),
    "createdAtLedger" INTEGER NOT NULL,
    "updatedAtLedger" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LendingPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhitelistedCurrency" (
    "address" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "decimals" INTEGER NOT NULL DEFAULT 7,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "addedAtLedger" INTEGER NOT NULL,
    "updatedAtLedger" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhitelistedCurrency_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "LendingConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "admin" TEXT NOT NULL,
    "feeReceiver" TEXT NOT NULL,
    "platformFeeBps" INTEGER NOT NULL,
    "liquidatorFeeBps" INTEGER NOT NULL,
    "minBufferBps" INTEGER NOT NULL,
    "maxBufferBps" INTEGER NOT NULL,
    "minLiqThresholdBps" INTEGER NOT NULL,
    "maxLiqThresholdBps" INTEGER NOT NULL,
    "oracleAddress" TEXT NOT NULL,
    "maxPriceStalenessSecs" BIGINT NOT NULL,
    "updatedAtLedger" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LendingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LendingListing_lender_idx" ON "LendingListing"("lender");
CREATE INDEX "LendingListing_status_idx" ON "LendingListing"("status");
CREATE INDEX "LendingListing_updatedAtLedger_idx" ON "LendingListing"("updatedAtLedger");

-- CreateIndex
CREATE INDEX "LendingPosition_borrower_idx" ON "LendingPosition"("borrower");
CREATE INDEX "LendingPosition_lender_idx" ON "LendingPosition"("lender");
CREATE INDEX "LendingPosition_status_idx" ON "LendingPosition"("status");
CREATE INDEX "LendingPosition_listingId_idx" ON "LendingPosition"("listingId");
CREATE INDEX "LendingPosition_updatedAtLedger_idx" ON "LendingPosition"("updatedAtLedger");

-- CreateIndex
CREATE INDEX "WhitelistedCurrency_enabled_idx" ON "WhitelistedCurrency"("enabled");

-- AddForeignKey
ALTER TABLE "LendingListing" ADD CONSTRAINT "LendingListing_collectionAddress_fkey" FOREIGN KEY ("collectionAddress") REFERENCES "Collection"("contractAddress") ON DELETE SET NULL ON UPDATE CASCADE;
