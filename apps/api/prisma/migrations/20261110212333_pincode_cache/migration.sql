-- CreateTable
CREATE TABLE "pincode_cache" (
    "pin" CHAR(6) NOT NULL,
    "data" JSONB,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pincode_cache_pkey" PRIMARY KEY ("pin")
);

