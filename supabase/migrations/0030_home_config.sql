-- ═══════════════════════════════════════════════════════════════════
-- 0030 — Home (PRD Home §3, §29): the ONLY thing Home owns is its
-- presentation — which sections show, in what order. One jsonb
-- column; every figure on the page stays consumed from its canonical
-- module. Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

alter table weddings add column if not exists home_config jsonb not null default '{}'::jsonb;

select 'home_config' as ready, count(*) from weddings where home_config is not null;
