-- AlterTable
ALTER TABLE "users" ADD COLUMN     "recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totp_enabled_at" TIMESTAMP(3),
ADD COLUMN     "totp_last_step" INTEGER,
ADD COLUMN     "totp_secret" TEXT;

