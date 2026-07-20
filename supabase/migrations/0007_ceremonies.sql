-- ═══════════════════════════════════════════════════════════════════
-- The ceremonies — the heart of the wedding. A multi-day celebration
-- may hold several (civil on Friday, religious on Saturday, a blessing
-- at dusk…). Each carries its kind, tradition, place and officiant.
-- ═══════════════════════════════════════════════════════════════════

create table ceremonies (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  kind text not null,                 -- civil, catholic, jewish, laïque/symbolic, interfaith…
  title text,                         -- "La cérémonie religieuse", "Vœux dans les jardins"…
  ceremony_date date,
  start_time text,                    -- "16:30"
  venue text,                         -- chapel, gardens, town hall…
  officiant text,                     -- celebrant, priest, rabbi, officier d'état civil…
  notes text,                         -- client-facing notes, in the house's voice
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index on ceremonies (wedding_id, ceremony_date);

alter table ceremonies enable row level security;

create policy "team full" on ceremonies
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on ceremonies
  for select using (app.couple_of(wedding_id));
-- Day-of coordinators need the ceremony at hand.
create policy "coordinator read" on ceremonies
  for select using (app.coordinator_of(wedding_id));
