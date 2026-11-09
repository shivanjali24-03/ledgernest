-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "recipients" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL,
    "last_run_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "emailed_to" TEXT[],
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_reports_active_next_run_at_idx" ON "scheduled_reports"("active", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_reports_organization_id_id_key" ON "scheduled_reports"("organization_id", "id");

-- CreateIndex
CREATE INDEX "report_deliveries_organization_id_schedule_id_created_at_idx" ON "report_deliveries"("organization_id", "schedule_id", "created_at");

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_organization_id_schedule_id_fkey" FOREIGN KEY ("organization_id", "schedule_id") REFERENCES "scheduled_reports"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

