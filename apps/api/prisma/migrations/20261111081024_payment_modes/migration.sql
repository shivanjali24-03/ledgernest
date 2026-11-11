-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "drawn_on" TEXT,
ADD COLUMN     "instrument_date" DATE,
ADD COLUMN     "instrument_no" TEXT,
ADD COLUMN     "mode" TEXT;

ALTER TABLE "payments" ADD CONSTRAINT "payments_mode" CHECK ("mode" IS NULL OR "mode" IN ('cash', 'cheque', 'dd', 'neft', 'rtgs', 'imps', 'upi', 'card', 'other'));
