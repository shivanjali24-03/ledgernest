-- AlterTable
ALTER TABLE "bill_lines" ADD COLUMN     "itc" TEXT NOT NULL DEFAULT 'eligible';

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "itc_blocked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_itc" CHECK ("itc" IN ('eligible', 'blocked', 'ineligible'));
