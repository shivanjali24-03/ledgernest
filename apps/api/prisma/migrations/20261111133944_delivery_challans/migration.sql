-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "purpose" TEXT;


ALTER TABLE "quotes" DROP CONSTRAINT "quotes_kind";
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_kind" CHECK ("kind" IN ('quote', 'proforma', 'sales_order', 'delivery_challan'));
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_purpose" CHECK ("purpose" IS NULL OR "purpose" IN ('job_work', 'approval', 'branch_transfer', 'exhibition', 'unknown_quantity', 'other'));
