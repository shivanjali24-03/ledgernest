-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "export_details" JSONB,
ADD COLUMN     "supply_kind" TEXT NOT NULL DEFAULT 'regular';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "lut_from" DATE,
ADD COLUMN     "lut_number" TEXT,
ADD COLUMN     "lut_to" DATE;

