-- CreateTable
CREATE TABLE "balance_confirmations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "as_of" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance" BIGINT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "their_balance" BIGINT,
    "note" TEXT,
    "responded_by" TEXT,
    "responded_at" TIMESTAMP(3),
    "sent_to" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "balance_confirmations_token_key" ON "balance_confirmations"("token");

-- CreateIndex
CREATE INDEX "balance_confirmations_organization_id_as_of_idx" ON "balance_confirmations"("organization_id", "as_of");

-- CreateIndex
CREATE UNIQUE INDEX "balance_confirmations_organization_id_contact_id_side_as_of_key" ON "balance_confirmations"("organization_id", "contact_id", "side", "as_of");

-- AddForeignKey
ALTER TABLE "balance_confirmations" ADD CONSTRAINT "balance_confirmations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_confirmations" ADD CONSTRAINT "balance_confirmations_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

