-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "cost_centre_id" UUID;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organization_id_cost_centre_id_fkey" FOREIGN KEY ("organization_id", "cost_centre_id") REFERENCES "cost_centres"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

