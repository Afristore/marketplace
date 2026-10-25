-- CreateTable
CREATE TABLE "IndexerError" (
    "id" SERIAL NOT NULL,
    "eventType" TEXT NOT NULL,
    "listingId" BIGINT,
    "ledgerSequence" INTEGER,
    "payload" JSONB,
    "error" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexerError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IndexerError_eventType_idx" ON "IndexerError"("eventType");

-- CreateIndex
CREATE INDEX "IndexerError_ledgerSequence_idx" ON "IndexerError"("ledgerSequence");
