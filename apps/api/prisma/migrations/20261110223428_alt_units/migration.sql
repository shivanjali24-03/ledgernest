-- AlterTable
ALTER TABLE "bill_lines" ADD COLUMN     "in_alt_unit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "in_alt_unit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "alt_factor" DECIMAL(13,4),
ADD COLUMN     "alt_unit" TEXT;

