-- ═══════════════════════════════════════════════════════════════════
-- 0017 — Financial foundations (application-financière brief §1)
--
-- What it does: the currency belongs to the COMMITMENT, not only to
-- the payment (§1.1) — budget_lines and budget_line_items gain a
-- non-null currency; exchange rates stop being improvised (§1.2) —
-- an fx_rates table holds pair, rate, date and source, and every
-- conversion references one of its rows; lines carry their traced
-- EUR equivalent so no total ever mixes currencies in silence.
--
-- Why: a £120,000 engagement stored as a bare 120000 makes every
-- cross-currency total silently false, and a conversion whose rate
-- cannot be found is not auditable.
--
-- If not run: the hub keeps working in EUR-only mode — currency
-- edits, rate holding and the exposure line stay politely disabled
-- with a held message; nothing breaks.
--
-- Rollback note: additive only — new columns and one new table. To
-- roll back, drop fx_rates and the added columns; no existing data
-- is modified by this migration.
--
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

-- §1.2 — a rate has a pair, a value, a date and a source. Nothing else
-- counts as a rate.
create table if not exists fx_rates (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid references weddings on delete cascade,
  pair text not null,                 -- e.g. 'GBP/EUR'
  rate numeric not null check (rate > 0),
  rate_date date not null,
  source text not null default '',
  created_at timestamptz not null default now()
);

alter table fx_rates enable row level security;

do $$ begin
  create policy "team full" on fx_rates
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;

-- §1.1 — the engagement is denominated; so is each of its sub-lines.
alter table budget_lines
  add column if not exists currency text not null default 'EUR',
  add column if not exists committed_eur numeric,
  add column if not exists fx_rate_id uuid references fx_rates on delete set null;

alter table budget_line_items
  add column if not exists currency text not null default 'EUR';

-- §1.2 — payments' EUR equivalents reference their rate too.
alter table payments
  add column if not exists fx_rate_id uuid references fx_rates on delete set null;
