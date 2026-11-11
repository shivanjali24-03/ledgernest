-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "signatory_designation" TEXT,
ADD COLUMN     "signatory_name" TEXT;

-- CreateTable
CREATE TABLE "organization_images" (
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_images_pkey" PRIMARY KEY ("organization_id","kind")
);

-- AddForeignKey
ALTER TABLE "organization_images" ADD CONSTRAINT "organization_images_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_images" ADD CONSTRAINT "organization_images_kind" CHECK ("kind" IN ('signature', 'seal'));
