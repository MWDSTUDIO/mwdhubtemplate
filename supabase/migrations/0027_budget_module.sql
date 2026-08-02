-- ═══════════════════════════════════════════════════════════════════
-- 0027 — Budget module (PRD Budget): the financial records the totals
-- are calculated from, instead of totals that are merely editable.
--   1. Payments gain a lifecycle (draft → expected → pending
--      verification → confirmed → rejected / reversed / refunded) and
--      a kind (payment, deposit, refund, credit note). Only confirmed
--      movements count in paid totals.
--   2. Invoices — also proposals and credit notes as records of
--      account (kind column), linkable to a vendor, a line, a paper.
--   3. Payment allocations: one settlement spread over invoices,
--      lines, or a security deposit.
--   4. Envelopes and lines learn to be archived (never hard-deleted).
--   5. Scenarios: a saved envelope set to compare and, at Estelle's
--      word, publish over the live scope.
--   6. Financial document links: one paper, several records — the
--      file is never duplicated.
--   7. Publication versions: what the couple was shown, kept.
--   8. Readings keep Estelle's corrections; papers know their page
--      count.
--   9. The couple's read of sub-lines follows the line's own status —
--      an unpublished line's detail was never theirs to fetch.
-- Safe to run twice: everything is "if not exists" / guarded.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. payment lifecycle ─────────────────────────────────────────────
alter table payments add column if not exists status text
  check (status in ('draft','expected','pending_verification','confirmed',
                    'rejected','reversed','refunded','partially_refunded'));
alter table payments add column if not exists kind text not null default 'payment'
  check (kind in ('payment','deposit','refund','credit_note'));
alter table payments add column if not exists reference text;

-- Carry-over: what was settled is confirmed; the rest is expected.
update payments set status = case when paid_at is not null then 'confirmed' else 'expected' end
  where status is null;
alter table payments alter column status set default 'expected';

-- ── 2. invoices (and proposals / credit notes as records) ────────────
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  vendor_id uuid references vendors on delete set null,
  budget_line_id uuid references budget_lines on delete set null,
  document_id uuid references vendor_documents on delete set null,
  kind text not null default 'invoice'
    check (kind in ('invoice','proposal','commitment','credit_note')),
  number text,
  label text not null default '—',
  issue_date date,
  due_date date,
  amount_ht numeric,
  vat_amount numeric,
  amount_ttc numeric,
  currency text not null default 'EUR',
  status text not null default 'draft'
    check (status in ('draft','received','approved','disputed','cancelled')),
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists invoices_wedding_idx on invoices (wedding_id, kind);
create index if not exists invoices_line_idx on invoices (budget_line_id);
alter table invoices enable row level security;
drop policy if exists "team full" on invoices;
create policy "team full" on invoices
  for all using (app.is_team()) with check (app.is_team());

alter table payments add column if not exists invoice_id uuid references invoices on delete set null;

-- ── 3. payment allocations ───────────────────────────────────────────
create table if not exists payment_allocations (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  payment_id uuid not null references payments on delete cascade,
  invoice_id uuid references invoices on delete cascade,
  budget_line_id uuid references budget_lines on delete cascade,
  kind text not null default 'invoice' check (kind in ('invoice','line','deposit')),
  amount numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists pay_alloc_payment_idx on payment_allocations (payment_id);
alter table payment_allocations enable row level security;
drop policy if exists "team full" on payment_allocations;
create policy "team full" on payment_allocations
  for all using (app.is_team()) with check (app.is_team());

-- ── 4. archive, never hard-delete ────────────────────────────────────
alter table budget_envelopes add column if not exists archived boolean not null default false;
alter table budget_lines add column if not exists archived boolean not null default false;

-- ── 5. scenarios ─────────────────────────────────────────────────────
create table if not exists budget_scenarios (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  label text not null,
  status text not null default 'draft' check (status in ('draft','published')),
  -- The envelope set, frozen: [{label, percent, recommended_pct,
  -- priority, locked, sort}] — compared, then published or kept.
  data jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists budget_scenarios_wedding_idx on budget_scenarios (wedding_id);
alter table budget_scenarios enable row level security;
drop policy if exists "team full" on budget_scenarios;
create policy "team full" on budget_scenarios
  for all using (app.is_team()) with check (app.is_team());

-- ── 6. one paper, several records ────────────────────────────────────
create table if not exists financial_document_links (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  document_id uuid not null references vendor_documents on delete cascade,
  target_kind text not null check (target_kind in ('budget_line','invoice','payment')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (document_id, target_kind, target_id)
);
create index if not exists fin_doc_links_target_idx on financial_document_links (target_kind, target_id);
alter table financial_document_links enable row level security;
drop policy if exists "team full" on financial_document_links;
create policy "team full" on financial_document_links
  for all using (app.is_team()) with check (app.is_team());

-- ── 7. publication versions ──────────────────────────────────────────
create table if not exists publication_versions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  kind text not null default 'budget',
  summary jsonb,
  snapshot jsonb,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists publication_versions_wedding_idx on publication_versions (wedding_id, kind, created_at);
alter table publication_versions enable row level security;
drop policy if exists "team full" on publication_versions;
create policy "team full" on publication_versions
  for all using (app.is_team()) with check (app.is_team());

-- ── 8. readings remember; papers know their length ───────────────────
alter table document_readings add column if not exists corrections jsonb;
alter table vendor_documents add column if not exists page_count int;
alter table vendor_documents add column if not exists file_sha256 text;
create index if not exists vendor_documents_sha_idx on vendor_documents (wedding_id, file_sha256);

-- ── 9. the couple reads only what is published ───────────────────────
drop policy if exists "couple read" on budget_line_items;
create policy "couple read" on budget_line_items
  for select using (
    app.couple_of(wedding_id)
    and exists (
      select 1 from budget_lines l
      where l.id = budget_line_items.budget_line_id
        and l.status = 'published'
    )
  );

select 'invoices' as ready, count(*) from invoices
union all select 'payment_allocations', count(*) from payment_allocations
union all select 'budget_scenarios', count(*) from budget_scenarios
union all select 'financial_document_links', count(*) from financial_document_links
union all select 'publication_versions', count(*) from publication_versions;
