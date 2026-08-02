-- ═══════════════════════════════════════════════════════════════════
-- 0032 — Wedding Moments registry (PRD Moments): the Desk's existing
-- wedding_events rows BECOME the canonical registry — same table,
-- same ids, same names, same dates, same order. The event file
-- (0024) already carries type, times, venue and archive; this
-- migration adds only the two missing timestamps and teaches the
-- modules to point at the registry. Nothing copied, nothing reset.
-- Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

alter table wedding_events add column if not exists created_at timestamptz default now();
alter table wedding_events add column if not exists updated_at timestamptz;

-- ── single-link references (§5, §6, §7) — never a copy ──────────────
alter table milestone_ops add column if not exists event_id uuid references wedding_events on delete set null;
alter table ceremonies add column if not exists event_id uuid references wedding_events on delete set null;
alter table budget_lines add column if not exists event_id uuid references wedding_events on delete set null;

-- ── multi-link references (§8–§11): vendors, documents, forms, boards
create table if not exists moment_links (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  event_id uuid not null references wedding_events on delete cascade,
  module text not null check (module in ('vendor', 'document', 'form', 'board')),
  record_id uuid not null,
  created_at timestamptz not null default now(),
  unique (event_id, module, record_id)
);

alter table moment_links enable row level security;
drop policy if exists "team full" on moment_links;
create policy "team full" on moment_links
  for all using (app.is_team()) with check (app.is_team());

-- ── control ─────────────────────────────────────────────────────────
select 'moments' as ready, count(*) from wedding_events
union all
select 'moment_links', count(*) from moment_links
union all
select 'ops_linked', count(*) from milestone_ops where event_id is not null;
