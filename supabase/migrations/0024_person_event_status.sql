-- ═══════════════════════════════════════════════════════════════════
-- 0024 — Wedding Communication, the model (final prompt, 2026-08-02)
--
-- REPLACES the earlier 0024 draft (never executed). One migration for
-- the whole lot-A model:
--
--   · guest_persons — the people inside a household: who attends,
--     eats, and needs looking after (dietary and accessibility live
--     at PERSON level; children carry their name and age here).
--   · person_event_status — for each person × each event:
--     attending · pending · declined (the mock's three words; 'invited'
--     is tolerated and read as pending). "Not invited" is the absence
--     of a row. The household's global status is only ever a displayed
--     aggregate, never a stored figure.
--   · guests gains the full American-stationery household file:
--     address line 2 and region, side, relationship, category, VIP,
--     tags, internal notes, archived.
--   · wedding_events gains the event file: internal name, type,
--     times, venue and address, dress code, capacity, RSVP deadline,
--     visibility, notes, archived, so the module manages events and
--     their Grid columns itself.
--
-- Carried over, nothing lost: every household gains one named person
-- (the invitation's principal), inheriting the household's existing
-- per-event replies from guest_events (pending → pending,
-- confirmed → attending, declined → declined). guest_events is left
-- untouched (legacy read, pre-0024 fallback).
--
-- If not run: the sheet keeps working; the new tabs degrade (the
-- grid and overview simply do not show their per-person figures).
--
-- Rollback note: additive —
--   drop table person_event_status; drop table guest_persons;
--   and ignore the new columns.
-- Idempotent: safe to run twice (seeds are guarded).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists guest_persons (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  household_id uuid not null references guests on delete cascade,
  full_name text,                              -- empty until "and Guest" gets a name
  kind text not null default 'adult' check (kind in ('adult', 'child')),
  age int,                                     -- children mostly; the caterer asks
  dietary text,                                -- the person eats, not the household
  accessibility text,                          -- steps, wheelchairs, quiet corners
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists person_event_status (
  person_id uuid not null references guest_persons on delete cascade,
  event_id uuid not null references wedding_events on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  status text not null default 'pending'
    check (status in ('attending', 'declined', 'pending', 'invited')),
  updated_at timestamptz not null default now(),
  primary key (person_id, event_id)
);

create index if not exists guest_persons_wedding_idx on guest_persons (wedding_id);
create index if not exists guest_persons_household_idx on guest_persons (household_id);
create index if not exists person_event_status_wedding_idx on person_event_status (wedding_id);
create index if not exists person_event_status_event_idx on person_event_status (event_id);

alter table guest_persons       enable row level security;
alter table person_event_status enable row level security;

-- RLS mirrors guests: the house holds everything, the couple manages
-- their own list (the T−30 pen-taking narrows this later, in software).
do $$ begin
  create policy "team full" on guest_persons
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "couple manage" on guest_persons
    for all using (app.couple_of(wedding_id)) with check (app.couple_of(wedding_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "team full" on person_event_status
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "couple manage" on person_event_status
    for all using (app.couple_of(wedding_id)) with check (app.couple_of(wedding_id));
exception when duplicate_object then null; end $$;

-- ── The household file (final prompt §A2) ───────────────────────────
alter table guests
  add column if not exists address_line2  text,
  add column if not exists region         text,
  add column if not exists side           text check (side in ('hers', 'his', 'mutual')),
  add column if not exists relationship   text,
  add column if not exists category       text,
  add column if not exists vip            boolean not null default false,
  add column if not exists accommodation_wished boolean not null default false,
  add column if not exists tags           text[] not null default '{}',
  add column if not exists notes_internal text,
  add column if not exists archived       boolean not null default false;

-- ── The event file (final prompt §A3) ───────────────────────────────
alter table wedding_events
  add column if not exists internal_name text,
  add column if not exists event_type    text,
  add column if not exists start_time    time,
  add column if not exists end_time      time,
  add column if not exists venue         text,
  add column if not exists venue_address text,
  add column if not exists dress_code    text,
  add column if not exists capacity      int,
  add column if not exists rsvp_deadline date,
  add column if not exists visibility    text not null default 'client'
    check (visibility in ('client', 'team')),
  add column if not exists notes         text,
  add column if not exists archived      boolean not null default false;

-- ── Carry-over: one person per household, with its replies ──────────
insert into guest_persons (wedding_id, household_id, full_name, sort)
select g.wedding_id, g.id,
       nullif(trim(concat(coalesce(g.first_names, ''), ' ', coalesce(g.surname, ''))), ''),
       0
from guests g
where not exists (select 1 from guest_persons p where p.household_id = g.id);

insert into person_event_status (person_id, event_id, wedding_id, status)
select p.id, ge.event_id, ge.wedding_id,
       case ge.rsvp::text
         when 'confirmed' then 'attending'
         when 'declined'  then 'declined'
         else 'pending'
       end
from guest_events ge
join guest_persons p on p.household_id = ge.guest_id
on conflict (person_id, event_id) do nothing;
