-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "category" TEXT;

-- CreateIndex
CREATE INDEX "Listing_category_idx" ON "Listing"("category");
