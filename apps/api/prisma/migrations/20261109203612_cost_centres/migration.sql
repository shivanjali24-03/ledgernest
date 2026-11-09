-- AlterTable
ALTER TABLE "bill_lines" ADD COLUMN     "cost_centre_id" UUID;

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "cost_centre_id" UUID;

-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN     "cost_centre_id" UUID;

-- CreateTable
CREATE TABLE "cost_centres" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'department',
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cost_centres_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_organization_id_id_key" ON "cost_centres"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_organization_id_code_key" ON "cost_centres"("organization_id", "code");

-- CreateIndex
CREATE INDEX "journal_lines_organization_id_cost_centre_id_idx" ON "journal_lines"("organization_id", "cost_centre_id");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_cost_centre_id_fkey" FOREIGN KEY ("organization_id", "cost_centre_id") REFERENCES "cost_centres"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_cost_centre_id_fkey" FOREIGN KEY ("organization_id", "cost_centre_id") REFERENCES "cost_centres"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_organization_id_cost_centre_id_fkey" FOREIGN KEY ("organization_id", "cost_centre_id") REFERENCES "cost_centres"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

