-- ═══════════════════════════════════════════════════════════════════
-- 0020 — A sub-line may carry its own category (Estelle's word,
-- 2026-08-02: "oui je veux")
--
-- What it does: budget_line_items gains envelope_id. Null — the
-- default, and every existing row — means the post follows its line's
-- category, exactly as before. Set, it means this one post counts in
-- its own category everywhere the envelopes speak (scope, distribution,
-- House Book), while remaining visually under its line and its vendor.
-- The DJ line inside a venue's quote, without splitting the line.
--
-- If not run: the per-post category selector on the vendor sheet says
-- it awaits this migration; everything else stands.
--
-- Rollback note: additive — ignore the column, or
--   alter table budget_line_items drop column envelope_id;
-- Idempotent: safe to run twice. RLS: items' existing policies cover
-- the new column; no policy changes.
-- ═══════════════════════════════════════════════════════════════════

alter table budget_line_items
  add column if not exists envelope_id uuid references budget_envelopes on delete set null;

create index if not exists budget_line_items_envelope_idx
  on budget_line_items (envelope_id);
