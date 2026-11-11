-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "gst_treatment" TEXT;

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_gst_treatment" CHECK ("gst_treatment" IS NULL OR "gst_treatment" IN ('registered', 'composition', 'sez', 'unregistered', 'consumer', 'overseas', 'uin'));
