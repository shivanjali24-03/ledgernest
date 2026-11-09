-- The exchange gain/loss accounts are system accounts too (created when an organisation first needs them)
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_system_key_check";
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_system_key_check" CHECK ("system_key" IS NULL OR "system_key" IN ('retained_earnings', 'opening_balance_equity', 'fx_realised', 'fx_unrealised'));
