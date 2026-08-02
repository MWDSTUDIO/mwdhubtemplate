-- ═══════════════════════════════════════════════════════════════════
-- 0021 — Wedding Communication, lot A (brief wedding-communication)
--
-- What it does:
--   · guests gains the American-stationery fields the list needs:
--     suffix (Jr. · Sr. · II…), and_guest (the placeholder that a
--     name will one day replace), provenance (couple · import ·
--     house), and house_touched_at — the mark that the house's hand
--     passed and must never be overwritten by an import or an agent.
--   · guest_import_batches — a dropped file (XLSX/CSV/paste) lands
--     here as a PROPOSAL: the column mapping, the normalised rows,
--     the flagged doubts. Nothing enters the list without Estelle's
--     review, exactly like a document reading. Team-only by RLS.
--
-- If not run: the list works as before; suffix/and-Guest/provenance
-- stay silent, the import desk says it awaits this migration.
--
-- Rollback note: additive — ignore the columns, or drop the table
--   (drop table guest_import_batches;) and the guests columns.
-- Idempotent: safe to run twice. RLS in this same file.
-- ═══════════════════════════════════════════════════════════════════

alter table guests
  add column if not exists suffix text,
  add column if not exists and_guest boolean not null default false,
  add column if not exists provenance text not null default 'couple'
    ,
  add column if not exists house_touched_at timestamptz;

do $$ begin
  alter table guests
    add constraint guests_provenance
    check (provenance in ('couple', 'import', 'house'));
exception when duplicate_object then null; end $$;

create table if not exists guest_import_batches (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  label text not null,
  -- { "sourceColumns": [...], "mapping": { "Nom": "surname", … } }
  mapping jsonb not null default '{}'::jsonb,
  -- normalised rows proposed by the agent, each with its flags and
  -- its possible collision with an existing household.
  rows jsonb not null default '[]'::jsonb,
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'dismissed')),
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists guest_import_batches_wedding_idx
  on guest_import_batches (wedding_id, status);

alter table guest_import_batches enable row level security;

do $$ begin
  create policy "team full" on guest_import_batches
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
-- No client policy: the import desk is the house's machinery.
