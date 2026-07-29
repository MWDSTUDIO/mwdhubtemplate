-- ═══════════════════════════════════════════════════════════════════
-- 0014 — The scope's three levels (brief §4 / D1, D2)
-- Recommended by the house (the counsel) · Forecast (the arbitrated
-- allocation, formerly "percent") · Committed (the real, from lines).
-- Existing forecasts seed the counsel so nothing reads as empty.
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

alter table budget_envelopes add column if not exists recommended_pct numeric;
update budget_envelopes set recommended_pct = percent where recommended_pct is null;
