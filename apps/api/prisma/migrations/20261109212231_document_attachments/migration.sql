-- CreateTable
CREATE TABLE "document_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_attachments_organization_id_document_type_document_idx" ON "document_attachments"("organization_id", "document_type", "document_id");

-- AddForeignKey
ALTER TABLE "document_attachments" ADD CONSTRAINT "document_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

