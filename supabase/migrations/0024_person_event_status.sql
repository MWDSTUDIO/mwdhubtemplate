-- ═══════════════════════════════════════════════════════════════════
-- 0024 — The reply is per person, per event (communication brief §2.5)
--
-- What it does: two tables.
--   · guest_persons — the people inside a household. The household
--     stays the envelope (guests); the person is who attends and eats.
--   · person_event_status — for each person × each event they are
--     invited to: invited · confirmed · declined · no_reply.
--     The household's "global" status becomes a displayed aggregate,
--     never a stored figure.
--
-- Carried over, nothing lost: every household gains one named person
-- (the invitation's principal), inheriting the household's existing
-- per-event replies from guest_events. Spouses, children and guests
-- are then added by hand in the grid — or by the import later.
-- guest_events is left untouched (legacy read, pre-0024 fallback).
--
-- If not run: the sheet keeps working; the grid simply does not show.
--
-- Rollback note: additive —
--   drop table person_event_status; drop table guest_persons;
-- Idempotent: safe to run twice (seeds are guarded).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists guest_persons (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  household_id uuid not null references guests on delete cascade,
  full_name text,                              -- empty until "and Guest" gets a name
  kind text not null default 'adult' check (kind in ('adult', 'child')),
  dietary text,                                -- the person eats, not the household
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists person_event_status (
  person_id uuid not null references guest_persons on delete cascade,
  event_id uuid not null references wedding_events on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  status text not null default 'invited'
    check (status in ('invited', 'confirmed', 'declined', 'no_reply')),
  updated_at timestamptz not null default now(),
  primary key (person_id, event_id)
);

create index if not exists guest_persons_wedding_idx on guest_persons (wedding_id);
create index if not exists guest_persons_household_idx on guest_persons (household_id);
create index if not exists person_event_status_wedding_idx on person_event_status (wedding_id);
create index if not exists person_event_status_event_idx on person_event_status (event_id);

alter table guest_persons      enable row level security;
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
         when 'confirmed' then 'confirmed'
         when 'declined'  then 'declined'
         else 'invited'
       end
from guest_events ge
join guest_persons p on p.household_id = ge.guest_id
on conflict (person_id, event_id) do nothing;
