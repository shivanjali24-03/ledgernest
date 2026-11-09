-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "address_line1" TEXT,
ADD COLUMN     "address_line2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "tax_id" TEXT,
ADD COLUMN     "time_zone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- CreateTable
CREATE TABLE "organization_logos" (
    "organization_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_logos_pkey" PRIMARY KEY ("organization_id")
);

-- AddForeignKey
ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing organisations get the time zone of their country (the column default is India's)
UPDATE "organizations" SET "time_zone" = CASE "country"
  WHEN 'AE' THEN 'Asia/Dubai' WHEN 'SA' THEN 'Asia/Riyadh' WHEN 'SG' THEN 'Asia/Singapore'
  WHEN 'GB' THEN 'Europe/London' WHEN 'FR' THEN 'Europe/Paris' WHEN 'DE' THEN 'Europe/Berlin'
  WHEN 'ES' THEN 'Europe/Madrid' WHEN 'US' THEN 'America/New_York' WHEN 'AU' THEN 'Australia/Sydney'
  ELSE "time_zone" END;

-- Logos: only small raster images, whatever the application does
ALTER TABLE "organization_logos"
  ADD CONSTRAINT "organization_logos_content_type_check" CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp')),
  ADD CONSTRAINT "organization_logos_size_check" CHECK (octet_length("data") BETWEEN 1 AND 262144);
