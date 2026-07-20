-- ═══════════════════════════════════════════════════════════════════
-- Access-barrier checks — run against a database seeded with
-- supabase/seed.sql (e.g. `supabase db reset` then `psql -f`).
-- Simulates each role by setting the request JWT, then asserts that a
-- client can NEVER read a draft or anything internal, that
-- coordinators only see The Wedding Days, and that the Vault answers
-- to Estelle alone.
-- ═══════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

create or replace function pg_temp.impersonate(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  camille  constant uuid := 'a0000000-0000-0000-0000-000000000003';
  jordane  constant uuid := 'a0000000-0000-0000-0000-000000000002';
  estelle  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  coord    constant uuid := 'a0000000-0000-0000-0000-000000000005';
  w        constant uuid := '11111111-1111-1111-1111-111111111111';
  n int;
begin
  -- Plant one draft of each kind as the service role.
  insert into timeline_milestones (id, wedding_id, month, label, status)
  values ('99999999-0000-0000-0000-000000000001', w, '2027-01-01', 'DRAFT barrier probe', 'draft');
  insert into budget_lines (id, wedding_id, label, budgeted, status)
  values ('99999999-0000-0000-0000-000000000002', w, 'DRAFT budget probe', 1, 'draft');

  -- ── 1. Client (Camille) ───────────────────────────────────────────
  perform pg_temp.impersonate(camille);

  select count(*) into n from timeline_milestones where status = 'draft';
  assert n = 0, 'client can read draft milestones';

  select count(*) into n from budget_lines where status = 'draft';
  assert n = 0, 'client can read draft budget lines';

  select count(*) into n from wedding_briefs;
  assert n = 0, 'client can read the house brief';

  select count(*) into n from internal_tasks;
  assert n = 0, 'client can read internal tasks';

  select count(*) into n from internal_budget_notes;
  assert n = 0, 'client can read internal budget notes';

  select count(*) into n from vendor_internal_notes;
  assert n = 0, 'client can read vendor internal notes';

  select count(*) into n from messages where channel = 'teamwork';
  assert n = 0, 'client can read the teamwork channel';

  select count(*) into n from contracts_vault;
  assert n = 0, 'client can read the vault';

  select count(*) into n from access_codes;
  assert n = 0, 'client can read access codes';

  select count(*) into n from documents where internal;
  assert n = 0, 'client can read internal documents';

  select count(*) into n from rooming_entries;
  assert n = 0, 'client can read the rooming list before it opens';

  select count(*) into n from envelope_notes where status = 'draft';
  assert n = 0, 'client can read draft envelope notes';

  -- Clients keep what is theirs: published material of their wedding.
  select count(*) into n from timeline_milestones where status = 'published';
  assert n > 0, 'client cannot read their published timeline';

  -- ── 2. Coordinator (Louise) — The Wedding Days, and only that ─────
  perform pg_temp.impersonate(coord);

  select count(*) into n from run_sheets;
  assert n > 0, 'coordinator cannot read run sheets';

  select count(*) into n from contact_sheets;
  assert n > 0, 'coordinator cannot read contact sheets';

  select count(*) into n from budget_lines;
  assert n = 0, 'coordinator can read the budget';

  select count(*) into n from guests;
  assert n = 0, 'coordinator can read guests';

  select count(*) into n from messages;
  assert n = 0, 'coordinator can read messages';

  select count(*) into n from contracts_vault;
  assert n = 0, 'coordinator can read the vault';

  -- ── 3. Team member with teamwork (Jordane) — everything but the vault
  perform pg_temp.impersonate(jordane);

  select count(*) into n from timeline_milestones where status = 'draft';
  assert n > 0, 'team cannot read drafts';

  select count(*) into n from messages where channel = 'teamwork';
  assert n > 0, 'teamwork member cannot read Between us';

  select count(*) into n from contracts_vault;
  assert n = 0, 'Jordane can read the vault — Estelle alone may';

  select count(*) into n from access_codes;
  assert n = 0, 'team can read access codes';

  -- ── 4. Estelle — the vault answers to her ─────────────────────────
  perform pg_temp.impersonate(estelle);

  select count(*) into n from contracts_vault;
  assert n > 0, 'Estelle cannot read her vault';

  -- The code RPC refuses the wrong code and accepts the seeded one.
  assert public.verify_code('vault', '0000') = false, 'vault accepts a wrong code';
  assert public.verify_code('vault', '2711') = true,  'vault refuses the right code';
  assert public.verify_code('teamwork', '0909') = true, 'teamwork refuses the right code';

  -- Jordane can never open the vault, even with the right code.
  perform pg_temp.impersonate(jordane);
  assert public.verify_code('vault', '2711') = false, 'the vault opens for someone else than Estelle';

  raise notice 'ACCESS BARRIERS: all assertions passed.';

  -- Clean the probes (back to service role).
  perform set_config('role', 'postgres', true);
  delete from timeline_milestones where id = '99999999-0000-0000-0000-000000000001';
  delete from budget_lines where id = '99999999-0000-0000-0000-000000000002';
end $$;
