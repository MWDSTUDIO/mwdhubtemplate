-- ═══════════════════════════════════════════════════════════════════
-- 0016 — Banking coordinates: structure, verification, history
-- (brief coordonnées bancaires §2, §5, §6, §8)
--
-- The governing sentence: the agent reads, a human verifies out of
-- band, the system keeps the trace of who verified and how. "Read"
-- and "verified" are never confused; nothing releases to the couple
-- below "verified"; a change of coordinates never overwrites.
--
-- Additive and idempotent — the encrypted blob and its team-only RLS
-- stay exactly as 0011 built them.
-- ═══════════════════════════════════════════════════════════════════

-- Structure around the blob: corridor, state, fingerprint, the trace.
alter table vendor_banking
  add column if not exists corridor text,
  add column if not exists status text not null default 'read'
    check (status in ('read', 'verified')),
  add column if not exists fingerprint text,
  add column if not exists verified_by text,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_method text
    check (verification_method in ('call', 'in_person') or verification_method is null),
  add column if not exists verification_contact text,
  add column if not exists source_document_id uuid,
  -- A newer reading NEVER replaces verified coordinates: it waits
  -- here, in parallel, until its own out-of-band verification (§6).
  add column if not exists pending_enc text,
  add column if not exists pending_fingerprint text,
  add column if not exists pending_corridor text,
  add column if not exists pending_source_document_id uuid,
  add column if not exists pending_read_at timestamptz;

-- Every version that ever held the truth, kept forever (§6).
create table if not exists vendor_banking_history (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  enc text not null,
  fingerprint text,
  corridor text,
  status text,
  verified_by text,
  verified_at timestamptz,
  verification_method text,
  verification_contact text,
  replaced_at timestamptz not null default now()
);

alter table vendor_banking_history enable row level security;

do $$ begin
  create policy "team full" on vendor_banking_history
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;

-- ── §8 — the server lock, not a reminder in the interface ─────────
-- An instalment cannot reveal banking to the couple unless the
-- vendor's coordinates are verified. Raised in Postgres so no code
-- path around the interface can slip through.
create or replace function public.guard_banking_reveal()
returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  if new.reveal_banking is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.reveal_banking is true then
    return new; -- already revealed before this rule existed
  end if;
  select vb.status into v_status
  from budget_lines bl
  join vendor_banking vb on vb.vendor_id = bl.vendor_id
  where bl.id = new.budget_line_id;
  if v_status is distinct from 'verified' then
    raise exception 'banking_not_verified'
      using hint = 'Verify the vendor''s coordinates out of band before revealing them.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_banking_reveal on payments;
create trigger trg_guard_banking_reveal
  before insert or update of reveal_banking on payments
  for each row execute function public.guard_banking_reveal();

-- ── §9 — purge: a coordinate kept without reason is a risk ────────
-- Wipes banking (and its history) for weddings whose day has passed
-- by the given delay. Called by a scheduled function, or by hand.
create or replace function public.purge_vendor_banking(p_days int default 180)
returns int
language plpgsql
security definer as $$
declare
  n int;
begin
  delete from vendor_banking vb
  using weddings w
  where w.id = vb.wedding_id
    and w.date_end is not null
    and w.date_end < (current_date - p_days);
  get diagnostics n = row_count;
  delete from vendor_banking_history vh
  using weddings w
  where w.id = vh.wedding_id
    and w.date_end is not null
    and w.date_end < (current_date - p_days);
  return n;
end $$;

-- The scheduled purge calls with the service key; nobody else may.
revoke all on function public.purge_vendor_banking(int) from public;
grant execute on function public.purge_vendor_banking(int) to service_role;
