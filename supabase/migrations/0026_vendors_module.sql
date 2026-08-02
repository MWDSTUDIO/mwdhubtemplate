-- ═══════════════════════════════════════════════════════════════════
-- 0026 — Vendors: one vendor record, one document record (PRD Vendors)
--
-- The existing `vendors` row becomes the WEDDING RELATIONSHIP
-- (WeddingVendor); a new `vendor_registry` holds the PERMANENT house
-- profile a vendor keeps across weddings. Budget keeps referencing
-- vendors.id exactly as today — nothing moves under its feet.
--
--   · vendor_registry   — the permanent company/professional profile
--   · vendors           — + registry_id, relationship dates, role,
--                         archived, last_activity_at, internal notes
--   · vendor_contacts   — several contacts per registry (main, sales,
--                         production, accounts, emergency, other)
--   · vendor_notes      — dated internal notes, author kept
--   · vendor_stage enum — the full pipeline (scouted → … → archived);
--                         legacy values keep working
--   · vendor_doc_type   — + insurance, licence, bank_details,
--                         portfolio, other; vendor_documents.archived
--
-- Carry-over: every existing vendor gains its registry row (one per
-- wedding-vendor — merging across weddings is Estelle's gesture, via
-- the duplicate detector, never automatic).
--
-- If not run: the vendors page keeps working exactly as today; the
-- profile's new fields simply do not save.
--
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

-- ── the pipeline, complete ──────────────────────────────────────────
alter type vendor_stage add value if not exists 'proposal_requested';
alter type vendor_stage add value if not exists 'proposal_received';
alter type vendor_stage add value if not exists 'in_review';
alter type vendor_stage add value if not exists 'shortlisted';
alter type vendor_stage add value if not exists 'selected';
alter type vendor_stage add value if not exists 'completed';
alter type vendor_stage add value if not exists 'archived';

-- ── document types, complete ────────────────────────────────────────
alter type vendor_doc_type add value if not exists 'insurance';
alter type vendor_doc_type add value if not exists 'licence';
alter type vendor_doc_type add value if not exists 'bank_details';
alter type vendor_doc_type add value if not exists 'portfolio';
alter type vendor_doc_type add value if not exists 'other';

alter table vendor_documents
  add column if not exists archived boolean not null default false;

-- ── the permanent profile ───────────────────────────────────────────
create table if not exists vendor_registry (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trading_name text,
  category text not null default '',
  country text,
  city text,
  languages text[] not null default '{}',
  website text,
  instagram text,
  portfolio_url text,
  email text,
  phone text,
  whatsapp text,
  timezone text,
  vat_number text,
  rating int check (rating between 1 and 5),
  tags text[] not null default '{}',
  notes_internal text,
  created_at timestamptz not null default now()
);
alter table vendor_registry enable row level security;
do $$ begin
  create policy "team full" on vendor_registry
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
-- No client policy: the registry is the house's address book.

-- ── the wedding relationship, enriched ──────────────────────────────
alter table vendors
  add column if not exists registry_id uuid references vendor_registry on delete set null,
  add column if not exists role text,
  add column if not exists lead_planner text,
  add column if not exists contacted_on date,
  add column if not exists proposal_requested_on date,
  add column if not exists proposal_received_on date,
  add column if not exists selected_on date,
  add column if not exists contracted_on date,
  add column if not exists completed boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists notes_internal text,
  add column if not exists last_activity_at timestamptz not null default now();
create index if not exists vendors_registry_idx on vendors (registry_id);

-- ── several contacts per vendor ─────────────────────────────────────
create table if not exists vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid not null references vendor_registry on delete cascade,
  contact_role text not null default 'main'
    check (contact_role in ('main', 'sales', 'production', 'accounts', 'emergency', 'other')),
  name text not null,
  email text,
  phone text,
  whatsapp text,
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists vendor_contacts_registry_idx on vendor_contacts (registry_id);
alter table vendor_contacts enable row level security;
do $$ begin
  create policy "team full" on vendor_contacts
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;

-- ── dated internal notes ────────────────────────────────────────────
create table if not exists vendor_notes (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  vendor_id uuid not null references vendors on delete cascade,
  author text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists vendor_notes_vendor_idx on vendor_notes (vendor_id, created_at desc);
alter table vendor_notes enable row level security;
do $$ begin
  create policy "team full" on vendor_notes
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;

-- ── carry-over: every wedding-vendor gains its registry row ─────────
insert into vendor_registry (id, legal_name, category)
select v.id, v.name, v.category
from vendors v
where v.registry_id is null
  and not exists (select 1 from vendor_registry r where r.id = v.id);

update vendors v
set registry_id = v.id
where v.registry_id is null
  and exists (select 1 from vendor_registry r where r.id = v.id);
