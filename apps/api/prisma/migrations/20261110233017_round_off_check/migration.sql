-- A total rounded to the rupee differs from subtotal plus tax by its round-off (under a rupee either way)
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_amounts";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts" CHECK ("subtotal" >= 0 AND "tax_total" >= 0 AND "round_off" > -100 AND "round_off" < 100 AND "total" = "subtotal" + "tax_total" + "round_off" AND "amount_paid" >= 0 AND "amount_paid" <= "total");
