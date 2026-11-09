-- CreateTable
CREATE TABLE "gst_slabs" (
    "id" UUID NOT NULL,
    "rate_ppm" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gst_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rate_ppm" INTEGER NOT NULL,
    "output_account_id" UUID NOT NULL,
    "input_account_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gst_slab_id" UUID,
    "supply" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_group_rates" (
    "organization_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "rate_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "tax_group_rates_pkey" PRIMARY KEY ("group_id","rate_id")
);

-- CreateIndex
CREATE INDEX "gst_slabs_effective_from_idx" ON "gst_slabs"("effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_organization_id_id_key" ON "tax_rates"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_groups_organization_id_id_key" ON "tax_groups"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_groups_organization_id_gst_slab_id_supply_key" ON "tax_groups"("organization_id", "gst_slab_id", "supply");

-- CreateIndex
CREATE INDEX "tax_group_rates_organization_id_rate_id_idx" ON "tax_group_rates"("organization_id", "rate_id");

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_organization_id_output_account_id_fkey" FOREIGN KEY ("organization_id", "output_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_organization_id_input_account_id_fkey" FOREIGN KEY ("organization_id", "input_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_groups" ADD CONSTRAINT "tax_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_groups" ADD CONSTRAINT "tax_groups_gst_slab_id_fkey" FOREIGN KEY ("gst_slab_id") REFERENCES "gst_slabs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_rates" ADD CONSTRAINT "tax_group_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_rates" ADD CONSTRAINT "tax_group_rates_organization_id_group_id_fkey" FOREIGN KEY ("organization_id", "group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_rates" ADD CONSTRAINT "tax_group_rates_organization_id_rate_id_fkey" FOREIGN KEY ("organization_id", "rate_id") REFERENCES "tax_rates"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Rates are 0–100%; a GST slab must split evenly into CGST and SGST halves
ALTER TABLE "gst_slabs" ADD CONSTRAINT "gst_slabs_rate_range" CHECK ("rate_ppm" BETWEEN 0 AND 1000000 AND "rate_ppm" % 2 = 0);
ALTER TABLE "gst_slabs" ADD CONSTRAINT "gst_slabs_dates_in_order" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");
-- The same rate can't be in force twice on one day
ALTER TABLE "gst_slabs" ADD CONSTRAINT "gst_slabs_no_overlap"
  EXCLUDE USING gist ("rate_ppm" WITH =, daterange("effective_from", "effective_to", '[]') WITH &&);

ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_rate_range" CHECK ("rate_ppm" BETWEEN 0 AND 1000000);
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_kind" CHECK ("kind" IN ('cgst', 'sgst', 'utgst', 'igst', 'cess', 'vat', 'sales_tax', 'other'));
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_name_length" CHECK (char_length("name") BETWEEN 2 AND 60);
CREATE UNIQUE INDEX "tax_rates_org_name_key" ON "tax_rates" ("organization_id", lower("name"));

ALTER TABLE "tax_groups" ADD CONSTRAINT "tax_groups_supply" CHECK ("supply" IS NULL OR "supply" IN ('intra', 'inter'));
ALTER TABLE "tax_groups" ADD CONSTRAINT "tax_groups_name_length" CHECK (char_length("name") BETWEEN 2 AND 60);
CREATE UNIQUE INDEX "tax_groups_org_name_key" ON "tax_groups" ("organization_id", lower("name"));

-- India's GST slabs. GST 2.0 (22 September 2025) kept 0%, 0.25%, 3%, 5% and 18%, added 40%,
-- and retired 12% and 28%, which stay for entries dated before the change.
INSERT INTO "gst_slabs" ("id", "rate_ppm", "label", "description", "effective_from", "effective_to", "updated_at") VALUES
  (gen_random_uuid(), 0,      'Nil rated',          'Essentials such as fresh produce, milk, education and healthcare services', '2017-07-01', NULL, now()),
  (gen_random_uuid(), 2500,   'Rough diamonds',     'Rough precious and semi-precious stones',                                   '2017-07-01', NULL, now()),
  (gen_random_uuid(), 30000,  'Gold and jewellery', 'Gold, silver, jewellery and precious metals',                               '2017-07-01', NULL, now()),
  (gen_random_uuid(), 50000,  'Merit rate',         'Everyday goods and services',                                               '2017-07-01', NULL, now()),
  (gen_random_uuid(), 180000, 'Standard rate',      'Most goods and services',                                                   '2017-07-01', NULL, now()),
  (gen_random_uuid(), 400000, 'Demerit rate',       'Luxury and sin goods such as tobacco, pan masala, aerated drinks and luxury cars', '2025-09-22', NULL, now()),
  (gen_random_uuid(), 120000, 'Former 12% rate',    'Retired by GST 2.0; for entries dated before 22 September 2025',           '2017-07-01', '2025-09-21', now()),
  (gen_random_uuid(), 280000, 'Former 28% rate',    'Retired by GST 2.0; for entries dated before 22 September 2025',           '2017-07-01', '2025-09-21', now());
