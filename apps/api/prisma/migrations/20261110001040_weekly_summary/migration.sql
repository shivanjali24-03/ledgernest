-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "weekly_summary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weekly_summary_sent_on" DATE;

