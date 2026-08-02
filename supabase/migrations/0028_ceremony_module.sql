-- ═══════════════════════════════════════════════════════════════════
-- 0028 — Ceremony module (PRD Ceremony): the ceremony becomes a
-- living operational object, not only a form.
--   1. The ceremony learns its state (draft → ready for review →
--      approved → published → completed), its duration, its Plan B,
--      its archive, its readiness marks, its Timeline anchor.
--      Existing ceremonies carry over as PUBLISHED — the couple
--      keeps seeing exactly what they see today.
--   2. Participants — referencing existing people (guest_persons)
--      or vendors, never duplicating them; externals by name.
--   3. The ceremony flow, ordered, with durations.
--   4. Music assignments; 5. Readings; 6. Logistics (internal);
--   7. Document links — one canonical file, never copied.
--   8. The couple reads only what is published and approved.
-- Safe to run twice: everything is "if not exists" / guarded.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. the ceremony's own life ───────────────────────────────────────
alter table ceremonies add column if not exists status text
  check (status in ('draft','ready_for_review','approved','published','completed'));
update ceremonies set status = 'published' where status is null;
alter table ceremonies alter column status set default 'draft';
alter table ceremonies add column if not exists duration_min int;
alter table ceremonies add column if not exists plan_b text;
alter table ceremonies add column if not exists archived boolean not null default false;
alter table ceremonies add column if not exists updated_at timestamptz not null default now();
-- Readiness marks: {"check_key": "required"|"optional"|"na"} (§16).
alter table ceremonies add column if not exists checklist jsonb not null default '{}'::jsonb;
alter table ceremonies add column if not exists milestone_id uuid references timeline_milestones on delete set null;

-- The couple reads published ceremonies alone (§14); what exists
-- today was carried over as published, so nothing disappears.
drop policy if exists "couple read" on ceremonies;
create policy "couple read" on ceremonies
  for select using (app.couple_of(wedding_id) and status = 'published' and archived = false);

-- ── 2. participants ──────────────────────────────────────────────────
create table if not exists ceremony_participants (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  ceremony_id uuid not null references ceremonies on delete cascade,
  person_id uuid references guest_persons on delete set null,
  vendor_id uuid references vendors on delete set null,
  name text,
  role text not null default 'other',
  note_internal text,
  client_visible boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cer_participants_idx on ceremony_participants (ceremony_id, sort);
alter table ceremony_participants enable row level security;
drop policy if exists "team full" on ceremony_participants;
create policy "team full" on ceremony_participants
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "couple read" on ceremony_participants;
create policy "couple read" on ceremony_participants
  for select using (
    app.couple_of(wedding_id) and client_visible
    and exists (select 1 from ceremonies c where c.id = ceremony_id and c.status = 'published')
  );
drop policy if exists "coordinator read" on ceremony_participants;
create policy "coordinator read" on ceremony_participants
  for select using (app.coordinator_of(wedding_id));

-- ── 3. the flow ──────────────────────────────────────────────────────
create table if not exists ceremony_flow (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  ceremony_id uuid not null references ceremonies on delete cascade,
  block_type text not null default 'other',
  title text not null,
  description text,
  participant_id uuid references ceremony_participants on delete set null,
  duration_min int,
  note_internal text,
  note_client text,
  archived boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cer_flow_idx on ceremony_flow (ceremony_id, sort);
alter table ceremony_flow enable row level security;
drop policy if exists "team full" on ceremony_flow;
create policy "team full" on ceremony_flow
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "couple read" on ceremony_flow;
create policy "couple read" on ceremony_flow
  for select using (
    app.couple_of(wedding_id) and archived = false
    and exists (select 1 from ceremonies c where c.id = ceremony_id and c.status = 'published')
  );
drop policy if exists "coordinator read" on ceremony_flow;
create policy "coordinator read" on ceremony_flow
  for select using (app.coordinator_of(wedding_id));

-- ── 4. music ─────────────────────────────────────────────────────────
create table if not exists ceremony_music (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  ceremony_id uuid not null references ceremonies on delete cascade,
  slot text not null default 'other',
  title text not null,
  artist text,
  version text,
  performer text,
  vendor_id uuid references vendors on delete set null,
  duration_min numeric,
  document_id uuid references documents on delete set null,
  cue text,
  flow_id uuid references ceremony_flow on delete set null,
  note_internal text,
  status text not null default 'proposed' check (status in ('proposed','approved')),
  archived boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cer_music_idx on ceremony_music (ceremony_id, sort);
alter table ceremony_music enable row level security;
drop policy if exists "team full" on ceremony_music;
create policy "team full" on ceremony_music
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "couple read" on ceremony_music;
create policy "couple read" on ceremony_music
  for select using (
    app.couple_of(wedding_id) and status = 'approved' and archived = false
    and exists (select 1 from ceremonies c where c.id = ceremony_id and c.status = 'published')
  );
drop policy if exists "coordinator read" on ceremony_music;
create policy "coordinator read" on ceremony_music
  for select using (app.coordinator_of(wedding_id));

-- ── 5. readings ──────────────────────────────────────────────────────
create table if not exists ceremony_readings (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  ceremony_id uuid not null references ceremonies on delete cascade,
  title text not null,
  excerpt text,
  reader_participant_id uuid references ceremony_participants on delete set null,
  language text,
  duration_min int,
  document_id uuid references documents on delete set null,
  note_internal text,
  note_client text,
  status text not null default 'proposed' check (status in ('proposed','approved')),
  archived boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cer_readings_idx on ceremony_readings (ceremony_id, sort);
alter table ceremony_readings enable row level security;
drop policy if exists "team full" on ceremony_readings;
create policy "team full" on ceremony_readings
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "couple read" on ceremony_readings;
create policy "couple read" on ceremony_readings
  for select using (
    app.couple_of(wedding_id) and status = 'approved' and archived = false
    and exists (select 1 from ceremonies c where c.id = ceremony_id and c.status = 'published')
  );
drop policy if exists "coordinator read" on ceremony_readings;
create policy "coordinator read" on ceremony_readings
  for select using (app.coordinator_of(wedding_id));

-- ── 6. logistics — internal, never the couple's (§14) ────────────────
create table if not exists ceremony_logistics (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  ceremony_id uuid not null references ceremonies on delete cascade,
  item text not null,
  detail text,
  qty int,
  owner text,
  vendor_id uuid references vendors on delete set null,
  budget_line_id uuid references budget_lines on delete set null,
  document_id uuid references documents on delete set null,
  status text not null default 'open' check (status in ('open','ready','not_required')),
  note_internal text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cer_logistics_idx on ceremony_logistics (ceremony_id, sort);
alter table ceremony_logistics enable row level security;
drop policy if exists "team full" on ceremony_logistics;
create policy "team full" on ceremony_logistics
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "coordinator read" on ceremony_logistics;
create policy "coordinator read" on ceremony_logistics
  for select using (app.coordinator_of(wedding_id));

-- ── 7. document links — one canonical file (§11) ─────────────────────
create table if not exists ceremony_documents (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  ceremony_id uuid not null references ceremonies on delete cascade,
  document_id uuid not null references documents on delete cascade,
  role text not null default 'other',
  created_at timestamptz not null default now(),
  unique (ceremony_id, document_id)
);
alter table ceremony_documents enable row level security;
drop policy if exists "team full" on ceremony_documents;
create policy "team full" on ceremony_documents
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "couple read" on ceremony_documents;
create policy "couple read" on ceremony_documents
  for select using (
    app.couple_of(wedding_id)
    and exists (select 1 from ceremonies c where c.id = ceremony_id and c.status = 'published')
    and exists (select 1 from documents d where d.id = document_id and d.internal = false)
  );
drop policy if exists "coordinator read" on ceremony_documents;
create policy "coordinator read" on ceremony_documents
  for select using (app.coordinator_of(wedding_id));

select 'ceremony_participants' as ready, count(*) from ceremony_participants
union all select 'ceremony_flow', count(*) from ceremony_flow
union all select 'ceremony_music', count(*) from ceremony_music
union all select 'ceremony_readings', count(*) from ceremony_readings
union all select 'ceremony_logistics', count(*) from ceremony_logistics
union all select 'ceremony_documents', count(*) from ceremony_documents;
