-- ═══════════════════════════════════════════════════════════════════
-- 0031 — Forms (PRD Forms): the module becomes a curated library of
-- external questionnaires (Dubsado first). The Inner House presents,
-- organises and tracks the cards; the external provider keeps the
-- questionnaire and the answers. Nothing is deleted, nothing is
-- remapped: legacy statuses stay valid, legacy in-app forms keep
-- working. Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

-- ── categories the team curates (§6 — never hard-coded) ─────────────
create table if not exists form_categories (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  name text not null,
  sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

alter table form_categories enable row level security;
drop policy if exists "team full" on form_categories;
create policy "team full" on form_categories
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "couple read live" on form_categories;
create policy "couple read live" on form_categories
  for select using (app.couple_of(wedding_id) and not archived);

-- ── the card fields (§5) — all additive ─────────────────────────────
alter table forms add column if not exists internal_title text;
alter table forms add column if not exists category_id uuid references form_categories on delete set null;
alter table forms add column if not exists description text;
alter table forms add column if not exists cover_path text;
alter table forms add column if not exists cover_focal text;
alter table forms add column if not exists provider text;
alter table forms add column if not exists external_url text;
alter table forms add column if not exists cta_label text;
alter table forms add column if not exists client_visible boolean not null default true;
alter table forms add column if not exists shared_at date;
alter table forms add column if not exists due_date date;
alter table forms add column if not exists submitted_at date;
alter table forms add column if not exists last_checked_at date;
alter table forms add column if not exists note_internal text;
alter table forms add column if not exists note_client text;
alter table forms add column if not exists created_by text;
alter table forms add column if not exists created_at timestamptz default now();
alter table forms add column if not exists updated_at timestamptz;
alter table forms add column if not exists archived boolean not null default false;
alter table forms add column if not exists archived_at timestamptz;

-- ── the status system (§8) — new values join the legacy three ───────
alter table forms drop constraint if exists forms_status_check;
alter table forms add constraint forms_status_check check (status in (
  'draft', 'ready', 'shared', 'in_progress', 'submitted', 'updated',
  'completed', 'awaiting', 'to_come'
));

-- ── couple visibility (§15): published, client-visible, live only ───
drop policy if exists "couple read" on forms;
drop policy if exists "couple read visible" on forms;
create policy "couple read visible" on forms
  for select using (
    app.couple_of(wedding_id)
    and client_visible
    and not archived
    and status not in ('draft', 'ready')
  );

-- ── the card's history (§28) — internal material, its own table ─────
create table if not exists form_history (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  actor text not null default '',
  action text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

alter table form_history enable row level security;
drop policy if exists "team full" on form_history;
create policy "team full" on form_history
  for all using (app.is_team()) with check (app.is_team());

-- ── control ─────────────────────────────────────────────────────────
select 'form_categories' as ready, count(*) from form_categories
union all
select 'form_history', count(*) from form_history
union all
select 'forms_with_url', count(*) from forms where external_url is not null;
