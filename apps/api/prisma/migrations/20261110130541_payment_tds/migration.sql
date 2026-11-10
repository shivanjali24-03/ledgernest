-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "tds_account_id" UUID,
ADD COLUMN     "tds_amount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tds_base" BIGINT,
ADD COLUMN     "tds_rate_ppm" INTEGER,
ADD COLUMN     "tds_section" TEXT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_tds_account_id_fkey" FOREIGN KEY ("organization_id", "tds_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

