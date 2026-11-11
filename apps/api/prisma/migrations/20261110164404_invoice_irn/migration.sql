-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "irn" TEXT,
ADD COLUMN     "irn_ack_date" TEXT,
ADD COLUMN     "irn_ack_no" TEXT,
ADD COLUMN     "irn_signed_qr" TEXT;

