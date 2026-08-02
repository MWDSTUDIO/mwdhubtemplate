-- ═══════════════════════════════════════════════════════════════════
-- 0019 — The vendor's budget home (Estelle's ask, studied 2026-08-02)
--
-- What it does: vendors gain envelope_id — the budget category a
-- vendor belongs to by default. Two vendors may point at the same
-- envelope (a category holds as many vendors as the house wishes);
-- the fine grain stays on budget_lines, whose own envelope_id and
-- vendor_id remain the source of truth for the figures. A new line
-- attached to a vendor inherits this envelope when it has none.
--
-- Why: until now a vendor reached an envelope only through lines born
-- of a document reading; allocating a vendor to a category by hand
-- was impossible.
--
-- If not run: the "budget category" selector on the vendor sheet says
-- it awaits this migration; line-level vendor attachment still works.
--
-- Rollback note: additive — to step back, ignore the column (or
--   alter table vendors drop column envelope_id;). Nothing else moves.
-- Idempotent: safe to run twice. RLS: vendors' existing policies
-- cover the new column; no policy changes.
-- ═══════════════════════════════════════════════════════════════════

alter table vendors
  add column if not exists envelope_id uuid references budget_envelopes on delete set null;

create index if not exists vendors_envelope_idx on vendors (envelope_id);
