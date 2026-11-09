-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_customer" BOOLEAN NOT NULL,
    "is_vendor" BOOLEAN NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "billing_address" JSONB NOT NULL,
    "shipping_address" JSONB,
    "state_code" CHAR(2),
    "currency" CHAR(3),
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_organization_id_archived_at_idx" ON "contacts"("organization_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_organization_id_id_key" ON "contacts"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_currency_fkey" FOREIGN KEY ("organization_id", "currency") REFERENCES "organization_currencies"("organization_id", "code") ON DELETE NO ACTION ON UPDATE CASCADE;


ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_or_vendor" CHECK ("is_customer" OR "is_vendor");
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_payment_terms" CHECK ("payment_terms_days" BETWEEN 0 AND 365);
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_name_length" CHECK (char_length("name") BETWEEN 2 AND 160);
CREATE UNIQUE INDEX "contacts_org_name_key" ON "contacts" ("organization_id", lower("name"));
