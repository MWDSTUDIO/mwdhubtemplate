-- ═══════════════════════════════════════════════════════════════════
-- 0022 — The house's analysis awaits Estelle's word (her ask, 2026-08-02)
--
-- What it does: weddings gains budget_analysis_status. Existing
-- analyses keep their place (default 'published' — nothing the couple
-- already reads disappears). From now on, every text the agent
-- composes lands as a DRAFT: Estelle reads it, reworks it in the
-- editor, and publishes it herself — or removes it. Nothing reaches
-- the couple before her word.
--
-- If not run: the analysis behaves as before (visible once composed);
-- the editor still edits and removes.
--
-- Rollback note: additive — ignore the column, or
--   alter table weddings drop column budget_analysis_status;
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

alter table weddings
  add column if not exists budget_analysis_status text not null default 'published';

do $$ begin
  alter table weddings
    add constraint weddings_analysis_status
    check (budget_analysis_status in ('draft', 'published'));
exception when duplicate_object then null; end $$;
