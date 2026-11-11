-- AlterTable
ALTER TABLE "vendor_credit_applications" ADD COLUMN     "rate" DECIMAL(20,10);

-- AlterTable
ALTER TABLE "vendor_credits" ADD COLUMN     "currency" CHAR(3),
ADD COLUMN     "rate" DECIMAL(20,10);

