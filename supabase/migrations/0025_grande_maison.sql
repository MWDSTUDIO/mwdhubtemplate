-- ═══════════════════════════════════════════════════════════════════
-- 0025 — Wedding Communication, lot C: the great house (final prompt)
--
-- Five mechanisms, one additive migration:
--
--   C1 · guest_export_snapshots — every export keeps its rows, so the
--        next one to the same recipient can offer "what changed since
--        your July 12 list" instead of a fourth full file.
--   C2 · event_counts_given — the recorded count: the figure given to
--        the caterer or the venue, dated and named. If the list moves
--        afterwards, the discrepancy alert stands in the Overview.
--   C3 · weddings.pen_taken_from + guest_change_proposals — from that
--        date the couple's edits become proposals under Estelle's
--        attention, applied in one click; never direct writes.
--   C4 · properties / room_blocks / room_assignments — accommodation
--        deepened: houses, blocks with rates and deadlines, and
--        assignments whose remaining count computes itself. Existing
--        hotel_blocks rows carry over as one property per hotel;
--        the legacy table stays untouched.
--   C5 · correspondence.milestone_id + weddings comm note — a register
--        line linked to a Timeline milestone is sent when the
--        milestone is done (one fact, one place); the house's note
--        waits as a draft until published.
--
-- If not run: lots A and B behave exactly as today; the lot-C
-- instruments simply do not show.
--
-- Rollback note: additive — drop the new tables and columns.
-- Idempotent: safe to run twice (carry-over is guarded).
-- ═══════════════════════════════════════════════════════════════════

-- ── C1 · the memory of what left the house ──────────────────────────
create table if not exists guest_export_snapshots (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  kind text not null,
  event_id uuid references wedding_events on delete cascade,
  rows jsonb not null default '[]'::jsonb,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists guest_export_snapshots_idx
  on guest_export_snapshots (wedding_id, kind, created_at desc);
alter table guest_export_snapshots enable row level security;
do $$ begin
  create policy "team full" on guest_export_snapshots
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;

-- ── C2 · the recorded count ─────────────────────────────────────────
create table if not exists event_counts_given (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  event_id uuid not null references wedding_events on delete cascade,
  recipient text not null,
  figure int not null,
  given_on date not null default current_date,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists event_counts_given_idx
  on event_counts_given (wedding_id, event_id);
alter table event_counts_given enable row level security;
do $$ begin
  create policy "team full" on event_counts_given
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;

-- ── C3 · the house takes the pen ────────────────────────────────────
alter table weddings
  add column if not exists pen_taken_from date;

create table if not exists guest_change_proposals (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  household_id uuid references guests on delete cascade,
  kind text not null check (kind in ('add', 'update', 'delete', 'rsvp')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'proposed'
    check (status in ('proposed', 'applied', 'dismissed')),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists guest_change_proposals_idx
  on guest_change_proposals (wedding_id, status);
alter table guest_change_proposals enable row level security;
do $$ begin
  create policy "team full" on guest_change_proposals
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "couple proposes" on guest_change_proposals
    for insert with check (app.couple_of(wedding_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "couple reads own" on guest_change_proposals
    for select using (app.couple_of(wedding_id));
exception when duplicate_object then null; end $$;

-- ── C4 · accommodation, deepened ────────────────────────────────────
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  name text not null,
  property_type text not null default 'hotel'
    check (property_type in ('hotel', 'villa', 'residence')),
  contact_name text,
  contact_phone text,
  contact_email text,
  check_in text,
  check_out text,
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists room_blocks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  property_id uuid not null references properties on delete cascade,
  name text not null,
  date_start date,
  date_end date,
  booking_deadline date,
  booking_code text,
  booking_link text,
  rate numeric,
  rate_currency text not null default 'EUR',
  allocated int not null default 0,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists room_assignments (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  block_id uuid not null references room_blocks on delete cascade,
  household_id uuid not null references guests on delete cascade,
  room_type text,
  room_number text,
  date_start date,
  date_end date,
  status text not null default 'requested'
    check (status in ('not_requested', 'requested', 'reserved', 'confirmed', 'paid', 'cancelled')),
  confirmation_no text,
  created_at timestamptz not null default now()
);
create index if not exists room_blocks_property_idx on room_blocks (property_id);
create index if not exists room_assignments_block_idx on room_assignments (block_id);
create index if not exists room_assignments_wedding_idx on room_assignments (wedding_id);
alter table properties       enable row level security;
alter table room_blocks      enable row level security;
alter table room_assignments enable row level security;
do $$ begin
  create policy "team full" on properties
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "members read" on properties
    for select using (app.couple_of(wedding_id) or app.coordinator_of(wedding_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "team full" on room_blocks
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "members read" on room_blocks
    for select using (app.couple_of(wedding_id) or app.coordinator_of(wedding_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "team full" on room_assignments
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
-- No client policy on assignments: the rooming list is the house's.

-- Carry-over: one property per existing hotel, one block per row.
insert into properties (wedding_id, name, property_type, sort)
select distinct hb.wedding_id, hb.hotel, 'hotel', 0
from hotel_blocks hb
where not exists (
  select 1 from properties p
  where p.wedding_id = hb.wedding_id and p.name = hb.hotel
);
insert into room_blocks (wedding_id, property_id, name, booking_deadline, booking_code, allocated)
select hb.wedding_id, p.id,
       coalesce(hb.hotel, 'Block') || ' — held rooms',
       hb.cutoff_date, hb.booking_code, hb.rooms_held
from hotel_blocks hb
join properties p on p.wedding_id = hb.wedding_id and p.name = hb.hotel
where hb.active
  and not exists (
    select 1 from room_blocks b
    where b.property_id = p.id and b.booking_code is not distinct from hb.booking_code
  );

-- ── C5 · the correspondence register, linked to the Timeline ────────
alter table correspondence
  add column if not exists milestone_id uuid references milestones on delete set null;
alter table weddings
  add column if not exists comm_note text,
  add column if not exists comm_note_status text not null default 'draft'
    check (comm_note_status in ('draft', 'published'));
