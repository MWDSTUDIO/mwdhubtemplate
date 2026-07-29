-- ═══════════════════════════════════════════════════════════════════
-- 0013 — The analyst's desk (brief §3 / C6, C7)
-- A document reading lands as a PROPOSAL: nothing writes itself into
-- the budget until Estelle accepts, line by line or in one gesture.
-- Every accepted figure stays traceable to its source document.
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists document_readings (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  vendor_id uuid references vendors on delete set null,
  vendor_document_id uuid references vendor_documents on delete set null,
  label text not null,
  storage_path text,
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'dismissed')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table document_readings enable row level security;

do $$ begin
  create policy "team full" on document_readings
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;

-- C7 — every figure knows the paper and the page it came from.
alter table budget_line_items add column if not exists source_document_id uuid;
alter table budget_line_items add column if not exists source_page int;
alter table payments add column if not exists source_document_id uuid;
