-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "decided_by" TEXT,
ADD COLUMN     "decision_note" TEXT,
ADD COLUMN     "share_token" TEXT,
ADD COLUMN     "share_viewed_at" TIMESTAMP(3),
ADD COLUMN     "share_views" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "quotes_share_token_key" ON "quotes"("share_token");

