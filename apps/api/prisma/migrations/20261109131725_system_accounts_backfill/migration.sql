-- Every existing organisation gets the system accounts new ones are created with (see SYSTEM_ACCOUNTS
-- in @ledgernest/shared), named in the organisation's language.
INSERT INTO "accounts" ("id", "organization_id", "code", "name", "type", "subtype", "system_key", "updated_at")
SELECT gen_random_uuid(), o."id", s.code,
       CASE split_part(o."locale", '-', 1)
         WHEN 'hi' THEN s.hi WHEN 'mr' THEN s.mr WHEN 'es' THEN s.es WHEN 'fr' THEN s.fr
         WHEN 'de' THEN s.de WHEN 'ar' THEN s.ar ELSE s.en END,
       'equity', s.subtype, s.key, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('retained_earnings', '3900', 'retained_earnings', 'Retained earnings', 'प्रतिधारित आय', 'राखीव नफा', 'Resultados acumulados', 'Report à nouveau', 'Gewinnvortrag', 'الأرباح المحتجزة'),
  ('opening_balance_equity', '3990', 'other_equity', 'Opening balance equity', 'प्रारंभिक शेष पूंजी', 'प्रारंभिक शिल्लक भांडवल', 'Patrimonio de saldos iniciales', 'Capitaux d''ouverture', 'Eröffnungsbilanzkapital', 'حقوق ملكية الأرصدة الافتتاحية')
) AS s(key, code, subtype, en, hi, mr, es, fr, de, ar)
ON CONFLICT DO NOTHING;
