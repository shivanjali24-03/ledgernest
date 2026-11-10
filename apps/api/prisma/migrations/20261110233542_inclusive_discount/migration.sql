-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "discount" JSONB,
ADD COLUMN     "discount_total" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "prices_include_tax" BOOLEAN NOT NULL DEFAULT false;

