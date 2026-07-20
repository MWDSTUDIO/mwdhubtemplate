-- ═══════════════════════════════════════════════════════════════════
-- One paste, three graces.
--   1. The ceremonies table (migration 0007, never applied in prod).
--   2. Guest households: who the envelope covers — adults, children —
--      so plus-ones and little ones are counted, and dietary is kept.
--   3. The process, made personal: the house's four acts stand by
--      default, and any wedding may have its own movements.
-- Safe to run twice: everything is "if not exists".
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. ceremonies ────────────────────────────────────────────────────
create table if not exists ceremonies (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  kind text not null,
  title text,
  ceremony_date date,
  start_time text,
  venue text,
  officiant text,
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ceremonies_wedding_idx on ceremonies (wedding_id, ceremony_date);

alter table ceremonies enable row level security;

drop policy if exists "team full" on ceremonies;
create policy "team full" on ceremonies
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "couple read" on ceremonies;
create policy "couple read" on ceremonies
  for select using (app.couple_of(wedding_id));
drop policy if exists "coordinator read" on ceremonies;
create policy "coordinator read" on ceremonies
  for select using (app.coordinator_of(wedding_id));

-- ── 2. guest households ──────────────────────────────────────────────
alter table guests add column if not exists party_adults int not null default 2;
alter table guests add column if not exists party_children int not null default 0;
-- The household's word, holdable by hand (a phone call to the house):
alter table guests add column if not exists rsvp rsvp_status not null default 'pending';

-- ── 2b. documents keep their file; messages gain subjects ────────────
alter table documents add column if not exists storage_path text;
alter table messages add column if not exists subject text;

-- ── 2c. an attention may carry a link (a document to sign, a page) ───
alter table attentions add column if not exists link_url text;

-- ── 3. the process, per wedding ──────────────────────────────────────
create table if not exists process_steps (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  sort int not null default 0,
  title text not null,
  body text,
  created_at timestamptz not null default now()
);

alter table process_steps enable row level security;

drop policy if exists "team full" on process_steps;
create policy "team full" on process_steps
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "members read" on process_steps;
create policy "members read" on process_steps
  for select using (app.couple_of(wedding_id) or app.coordinator_of(wedding_id));

select 'ceremonies' as ready, count(*) from ceremonies
union all select 'process_steps', count(*) from process_steps;
