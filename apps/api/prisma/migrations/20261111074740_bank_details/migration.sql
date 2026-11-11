-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "bank_details" JSONB;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "bank_details" JSONB;

-- CreateTable
CREATE TABLE "ifsc_cache" (
    "ifsc" CHAR(11) NOT NULL,
    "data" JSONB,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ifsc_cache_pkey" PRIMARY KEY ("ifsc")
);

