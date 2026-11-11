-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "persons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "ship_addresses" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tds_section" TEXT,
ADD COLUMN     "whatsapp" TEXT;

