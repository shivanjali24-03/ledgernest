-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "last_reminded_at" TIMESTAMP(3),
ADD COLUMN     "reminders" INTEGER NOT NULL DEFAULT 0;

