-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "share_token" TEXT,
ADD COLUMN     "share_viewed_at" TIMESTAMP(3),
ADD COLUMN     "share_views" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_share_token_key" ON "invoices"("share_token");

