-- CreateTable
CREATE TABLE "organization_currencies" (
    "organization_id" UUID NOT NULL,
    "code" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_currencies_pkey" PRIMARY KEY ("organization_id","code")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "source" TEXT NOT NULL,
    "created_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_organization_id_currency_date_key" ON "exchange_rates"("organization_id", "currency", "date");

-- AddForeignKey
ALTER TABLE "organization_currencies" ADD CONSTRAINT "organization_currencies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_organization_id_currency_fkey" FOREIGN KEY ("organization_id", "currency") REFERENCES "organization_currencies"("organization_id", "code") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_currencies" ADD CONSTRAINT "organization_currencies_code_format" CHECK ("code" ~ '^[A-Z]{3}$');
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_positive" CHECK ("rate" > 0);
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_source" CHECK ("source" IN ('manual', 'ecb'));
