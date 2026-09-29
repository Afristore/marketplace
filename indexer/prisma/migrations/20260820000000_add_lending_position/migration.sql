-- CreateTable
CREATE TABLE "LendingPosition" (
    "id" BIGINT NOT NULL DEFAULT (nextval('"LendingPosition_id_seq"' ::TEXT)),
    "borrower" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "listingId" BIGINT,
    "amount" DECIMAL(32,7) NOT NULL DEFAULT '0',
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAtLedger" INTEGER NOT NULL DEFAULT (nextval('"LedgerSequence"' ::TEXT)),
    "updatedAtLedger" INTEGER NOT NULL DEFAULT (nextval('"LedgerSequence"' ::TEXT)),

    CONSTRAINT "LendingPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LendingPosition_borrower_idx" ON "LendingPosition" ("borrower");

CREATE INDEX "LendingPosition_lender_idx" ON "LendingPosition" ("lender");

CREATE INDEX "LendingPosition_status_idx" ON "LendingPosition" ("status");