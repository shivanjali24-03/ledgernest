-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "interest_rate_bp" INTEGER;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "interest_grace_days" INTEGER,
ADD COLUMN     "interest_method" TEXT,
ADD COLUMN     "interest_rate_bp" INTEGER;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "interest_grace_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "interest_method" TEXT NOT NULL DEFAULT 'simple',
ADD COLUMN     "interest_rate_bp" INTEGER;

