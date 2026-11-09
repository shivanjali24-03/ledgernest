-- CreateTable
CREATE TABLE "approval_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "min_amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" UUID,
    "payload" JSONB,
    "amount" BIGINT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_rules_organization_id_document_type_key" ON "approval_rules"("organization_id", "document_type");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_status_created_at_idx" ON "approval_requests"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_document_id_idx" ON "approval_requests"("organization_id", "document_id");

-- AddForeignKey
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

