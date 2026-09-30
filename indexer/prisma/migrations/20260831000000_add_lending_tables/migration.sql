-- CreateTable LendingPosition
CREATE TABLE "LendingPosition" (
    "positionId" BIGINT NOT NULL,
    "borrower" TEXT NOT NULL,
    "nftCollateral" TEXT NOT NULL,
    "nftTokenId" BIGINT NOT NULL,
    "loanAmount" DECIMAL(32,7) NOT NULL,
    "currency" TEXT NOT NULL,
    "interestRate" DECIMAL(10,7) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "loanStartTime" BIGINT NOT NULL,
    "dueDate" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "healthFactor" DECIMAL(32,7),
    "collateralValue" DECIMAL(32,7),
    "createdAtLedger" INTEGER NOT NULL,
    "updatedAtLedger" INTEGER NOT NULL,

    CONSTRAINT "LendingPosition_pkey" PRIMARY KEY ("positionId")
);

-- CreateTable LendingConfig
CREATE TABLE "LendingConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "platformFeeRate" DECIMAL(10,7) NOT NULL DEFAULT 100,
    "minHealthFactor" DECIMAL(10,7) NOT NULL DEFAULT 150,
    "liquidationThreshold" DECIMAL(10,7) NOT NULL DEFAULT 120,
    "updatedAtLedger" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LendingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LendingPosition_borrower_idx" ON "LendingPosition"("borrower");

-- CreateIndex
CREATE INDEX "LendingPosition_status_idx" ON "LendingPosition"("status");

-- CreateIndex
CREATE INDEX "LendingPosition_healthFactor_idx" ON "LendingPosition"("healthFactor");

-- CreateIndex
CREATE INDEX "LendingPosition_updatedAtLedger_idx" ON "LendingPosition"("updatedAtLedger");
