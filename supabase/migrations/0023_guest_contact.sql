-- ═══════════════════════════════════════════════════════════════════
-- 0023 — The household's full address book (Estelle's ask, 2026-08-02)
--
-- What it does: guests gains the contact fields the sheet was missing —
-- city, zip code, country, telephone, email. The street stays in
-- `address`; each new field is its own column because each export needs
-- them apart (the stationer posts, the planner telephones).
--
-- If not run: the sheet shows the new columns but a correction in one
-- of them does not land; every other column keeps working.
--
-- Rollback note: additive — ignore the columns, or drop them.
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

alter table guests
  add column if not exists city        text,
  add column if not exists postal_code text,
  add column if not exists country     text,
  add column if not exists phone       text,
  add column if not exists email       text;
