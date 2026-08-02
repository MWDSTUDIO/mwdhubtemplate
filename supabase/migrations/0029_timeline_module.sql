-- ═══════════════════════════════════════════════════════════════════
-- 0029 — Timeline module (PRD Timeline): the operational backbone.
--   1. milestone_ops — the OPERATIONAL life of a milestone, kept in
--      its own team-only table (house rule: internal material lives
--      in separate tables, never hidden columns): status, priority,
--      owner, due day, dependency, module links, internal note, and
--      the SOURCE anchor that lets Ceremony / Budget / Vendors update
--      one milestone in place — never a duplicate.
--   2. attentions learn urgency, owner, module, snooze and dismiss.
-- The milestones table itself is untouched — the couple's API stays
-- exactly as it was. Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. the operational side of a milestone ───────────────────────────
create table if not exists milestone_ops (
  milestone_id uuid primary key references timeline_milestones on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  op_status text not null default 'planned'
    check (op_status in ('draft','planned','waiting','in_progress','blocked','ready','completed','archived')),
  priority text not null default 'standard' check (priority in ('high','standard')),
  owner text,
  description text,
  due_date date,
  depends_on uuid references timeline_milestones on delete set null,
  -- Where the milestone looks: ceremony, budget, vendors,
  -- communication, design, documents — a reference, never a copy.
  module text,
  vendor_id uuid references vendors on delete set null,
  budget_line_id uuid references budget_lines on delete set null,
  document_id uuid references documents on delete set null,
  ceremony_id uuid references ceremonies on delete set null,
  note_internal text,
  -- The sync anchor: one (source, source_id) → one milestone, updated
  -- in place by the owning module (§13–§15).
  source text,
  source_id uuid,
  updated_at timestamptz not null default now()
);
create index if not exists milestone_ops_wedding_idx on milestone_ops (wedding_id);
create index if not exists milestone_ops_source_idx on milestone_ops (wedding_id, source, source_id);
alter table milestone_ops enable row level security;
drop policy if exists "team full" on milestone_ops;
create policy "team full" on milestone_ops
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "coordinator read" on milestone_ops;
create policy "coordinator read" on milestone_ops
  for select using (app.coordinator_of(wedding_id));

-- ── 2. attentions, enhanced (§9) ─────────────────────────────────────
alter table attentions add column if not exists urgency text not null default 'standard'
  check (urgency in ('high','standard'));
alter table attentions add column if not exists owner text;
alter table attentions add column if not exists module text;
alter table attentions add column if not exists snoozed_until date;
alter table attentions add column if not exists dismissed boolean not null default false;

select 'milestone_ops' as ready, count(*) from milestone_ops;
