-- ═══════════════════════════════════════════════════════════════════
-- The Inner House — row-level security
-- Five levels, enforced in the database, never in CSS:
--   1 client        the couple — published material of THEIR wedding only
--   2 coordinator   The Wedding Days of assigned weddings only
--   3 team          everything, drafts included
--   4 teamwork      Estelle + Jordane (plus a shared code at the app layer)
--   5 vault         Estelle alone (plus her personal code at the app layer)
-- ═══════════════════════════════════════════════════════════════════

create schema if not exists app;

create or replace function app.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'team'
  )
$$;

create or replace function app.is_teamwork() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'team' and is_teamwork
  )
$$;

create or replace function app.is_principal() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'team' and is_principal
  )
$$;

create or replace function app.couple_of(w uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from wedding_members
    where wedding_id = w and profile_id = auth.uid() and relation = 'couple'
  )
$$;

create or replace function app.coordinator_of(w uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from wedding_members
    where wedding_id = w and profile_id = auth.uid() and relation = 'coordinator'
  )
$$;

-- ── enable RLS everywhere ───────────────────────────────────────────
alter table weddings              enable row level security;
alter table wedding_briefs        enable row level security;
alter table wedding_events        enable row level security;
alter table profiles              enable row level security;
alter table wedding_members       enable row level security;
alter table timeline_milestones   enable row level security;
alter table monthly_notes         enable row level security;
alter table attentions            enable row level security;
alter table internal_tasks        enable row level security;
alter table boards                enable row level security;
alter table sub_boards            enable row level security;
alter table board_comments        enable row level security;
alter table vendors               enable row level security;
alter table vendor_internal_notes enable row level security;
alter table vendor_documents      enable row level security;
alter table budget_envelopes      enable row level security;
alter table envelope_notes        enable row level security;
alter table budget_lines          enable row level security;
alter table payments              enable row level security;
alter table internal_budget_notes enable row level security;
alter table guests                enable row level security;
alter table guest_events          enable row level security;
alter table hotel_blocks          enable row level security;
alter table rooming_list_state    enable row level security;
alter table rooming_entries       enable row level security;
alter table correspondence        enable row level security;
alter table hospitality_items     enable row level security;
alter table documents             enable row level security;
alter table messages              enable row level security;
alter table forms                 enable row level security;
alter table form_submissions      enable row level security;
alter table availability_proposals enable row level security;
alter table run_sheets            enable row level security;
alter table contact_sheets        enable row level security;
alter table call_preparations     enable row level security;
alter table contracts_vault       enable row level security;
alter table access_codes          enable row level security;   -- no policies: deny all
alter table notifications         enable row level security;
alter table push_subscriptions    enable row level security;

-- ── weddings & people ───────────────────────────────────────────────
create policy "team full" on weddings
  for all using (app.is_team()) with check (app.is_team());
create policy "members read their wedding" on weddings
  for select using (app.couple_of(id) or app.coordinator_of(id));

create policy "team only" on wedding_briefs
  for all using (app.is_team()) with check (app.is_team());

create policy "team full" on wedding_events
  for all using (app.is_team()) with check (app.is_team());
create policy "members read" on wedding_events
  for select using (app.couple_of(wedding_id) or app.coordinator_of(wedding_id));

-- Profiles hold names and roles only; any signed-in user may read names.
create policy "authenticated read" on profiles
  for select using (auth.uid() is not null);
create policy "own update" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Role fields can never be self-escalated: only the service role may
-- change role / is_principal / is_teamwork.
create or replace function app.protect_profile_flags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and (new.role is distinct from old.role
          or new.is_principal is distinct from old.is_principal
          or new.is_teamwork is distinct from old.is_teamwork) then
    raise exception 'role flags are managed by the house';
  end if;
  return new;
end $$;
create trigger protect_profile_flags before update on profiles
  for each row execute function app.protect_profile_flags();

create policy "team full" on wedding_members
  for all using (app.is_team()) with check (app.is_team());
create policy "own membership read" on wedding_members
  for select using (profile_id = auth.uid());

-- ── timeline: drafts never reach the client ─────────────────────────
create policy "team full" on timeline_milestones
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read published" on timeline_milestones
  for select using (app.couple_of(wedding_id) and status = 'published');

create policy "team full" on monthly_notes
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read published" on monthly_notes
  for select using (app.couple_of(wedding_id) and status = 'published');

create policy "team full" on attentions
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on attentions
  for select using (app.couple_of(wedding_id));
create policy "couple settle" on attentions
  for update using (app.couple_of(wedding_id))
  with check (app.couple_of(wedding_id));

-- A client may only move an attention's status (attend to it) — never
-- retitle or reschedule what the house entrusted.
create or replace function app.attention_client_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_team()
     and (new.title is distinct from old.title
          or new.due_date is distinct from old.due_date
          or new.milestone_id is distinct from old.milestone_id
          or new.wedding_id is distinct from old.wedding_id) then
    raise exception 'attentions are edited by the house';
  end if;
  return new;
end $$;
create trigger attention_client_guard before update on attentions
  for each row execute function app.attention_client_guard();

create policy "team only" on internal_tasks
  for all using (app.is_team()) with check (app.is_team());

-- ── design studio ───────────────────────────────────────────────────
create policy "team full" on boards
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on boards
  for select using (app.couple_of(wedding_id));

create policy "team full" on sub_boards
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on sub_boards
  for select using (app.couple_of(wedding_id));

create policy "team full" on board_comments
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on board_comments
  for select using (app.couple_of(wedding_id));
create policy "couple write own" on board_comments
  for insert with check (app.couple_of(wedding_id) and author_id = auth.uid());

-- ── vendors ─────────────────────────────────────────────────────────
create policy "team full" on vendors
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read visible" on vendors
  for select using (app.couple_of(wedding_id) and client_visible);

create policy "team only" on vendor_internal_notes
  for all using (app.is_team()) with check (app.is_team());

create policy "team full" on vendor_documents
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read visible" on vendor_documents
  for select using (app.couple_of(wedding_id) and client_visible);

-- ── budget ──────────────────────────────────────────────────────────
create policy "team full" on budget_envelopes
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on budget_envelopes
  for select using (app.couple_of(wedding_id));

create policy "team full" on envelope_notes
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read published" on envelope_notes
  for select using (app.couple_of(wedding_id) and status = 'published');

create policy "team full" on budget_lines
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read published" on budget_lines
  for select using (app.couple_of(wedding_id) and status = 'published');

create policy "team only" on payments
  for all using (app.is_team()) with check (app.is_team());

create policy "team only" on internal_budget_notes
  for all using (app.is_team()) with check (app.is_team());

-- ── guests: the couple builds the list ──────────────────────────────
create policy "team full" on guests
  for all using (app.is_team()) with check (app.is_team());
create policy "couple manage" on guests
  for all using (app.couple_of(wedding_id)) with check (app.couple_of(wedding_id));

create policy "team full" on guest_events
  for all using (app.is_team()) with check (app.is_team());
create policy "couple manage" on guest_events
  for all using (app.couple_of(wedding_id)) with check (app.couple_of(wedding_id));

create policy "team full" on hotel_blocks
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on hotel_blocks
  for select using (app.couple_of(wedding_id));

create policy "team read" on rooming_list_state
  for select using (app.is_team());
create policy "couple read" on rooming_list_state
  for select using (app.couple_of(wedding_id));
-- Opening the rooming list is Estelle's action alone.
create policy "principal opens" on rooming_list_state
  for all using (app.is_principal()) with check (app.is_principal());

create policy "team full" on rooming_entries
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read once opened" on rooming_entries
  for select using (
    app.couple_of(wedding_id)
    and exists (
      select 1 from rooming_list_state s
      where s.wedding_id = rooming_entries.wedding_id and s.opened
    )
  );

-- ── communication ───────────────────────────────────────────────────
create policy "team full" on correspondence
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read non-draft" on correspondence
  for select using (app.couple_of(wedding_id) and status <> 'draft');

create policy "team full" on hospitality_items
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on hospitality_items
  for select using (app.couple_of(wedding_id));

create policy "team full" on documents
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read shared" on documents
  for select using (app.couple_of(wedding_id) and not internal);

-- ── messages ────────────────────────────────────────────────────────
create policy "team client channel" on messages
  for select using (app.is_team() and channel = 'client');
create policy "team client channel write" on messages
  for insert with check (app.is_team() and channel = 'client' and author_id = auth.uid());
create policy "couple channel" on messages
  for select using (app.couple_of(wedding_id) and channel = 'client');
create policy "couple channel write" on messages
  for insert with check (
    app.couple_of(wedding_id) and channel = 'client' and author_id = auth.uid()
  );
-- "Between us" — Estelle & Jordane only. Not team-wide, not coordinators.
create policy "teamwork channel" on messages
  for select using (app.is_teamwork() and channel = 'teamwork');
create policy "teamwork channel write" on messages
  for insert with check (app.is_teamwork() and channel = 'teamwork' and author_id = auth.uid());

-- ── forms ───────────────────────────────────────────────────────────
create policy "team full" on forms
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on forms
  for select using (app.couple_of(wedding_id));

create policy "team full" on form_submissions
  for all using (app.is_team()) with check (app.is_team());
create policy "couple own submissions" on form_submissions
  for select using (app.couple_of(wedding_id) and submitted_by = auth.uid());
create policy "couple submit" on form_submissions
  for insert with check (app.couple_of(wedding_id) and submitted_by = auth.uid());

-- ── scheduling ──────────────────────────────────────────────────────
create policy "team full" on availability_proposals
  for all using (app.is_team()) with check (app.is_team());
create policy "couple read" on availability_proposals
  for select using (app.couple_of(wedding_id));
create policy "couple propose" on availability_proposals
  for insert with check (app.couple_of(wedding_id) and proposed_by = auth.uid());

-- ── the wedding days: coordinators enter here — and only here ───────
create policy "team full" on run_sheets
  for all using (app.is_team()) with check (app.is_team());
create policy "coordinator read" on run_sheets
  for select using (app.coordinator_of(wedding_id));

create policy "team full" on contact_sheets
  for all using (app.is_team()) with check (app.is_team());
create policy "coordinator read" on contact_sheets
  for select using (app.coordinator_of(wedding_id));

-- ── teamwork room ───────────────────────────────────────────────────
create policy "teamwork only" on call_preparations
  for all using (app.is_teamwork()) with check (app.is_teamwork());

-- ── the vault: Estelle alone — locked server-side, not hidden ───────
create policy "principal only" on contracts_vault
  for all using (app.is_principal()) with check (app.is_principal());

-- access_codes: RLS enabled, zero policies — only the service role
-- (server-side verification route) can ever read or write.

-- ── notifications ───────────────────────────────────────────────────
create policy "own read" on notifications
  for select using (recipient_id = auth.uid());
create policy "own mark read" on notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy "own subscriptions" on push_subscriptions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
