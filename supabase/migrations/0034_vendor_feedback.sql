-- ═══════════════════════════════════════════════════════════════════
-- 0034 — The couple's word on a vendor (PRD Vendors Client View).
-- One clean model, separate from the house's internal rating
-- (vendor_registry.rating, team only): the couple writes its own
-- feedback, one row per person per vendor, and the team reads it.
-- Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists vendor_feedback (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  vendor_id uuid not null references vendors on delete cascade,
  author_id uuid not null references profiles on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (vendor_id, author_id)
);

alter table vendor_feedback enable row level security;
drop policy if exists "team read" on vendor_feedback;
create policy "team read" on vendor_feedback
  for select using (app.is_team());
drop policy if exists "couple own feedback" on vendor_feedback;
create policy "couple own feedback" on vendor_feedback
  for all using (app.couple_of(wedding_id) and author_id = auth.uid())
  with check (app.couple_of(wedding_id) and author_id = auth.uid());

-- ── control ─────────────────────────────────────────────────────────
select 'vendor_feedback' as ready, count(*) from vendor_feedback;
