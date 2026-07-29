-- ═══════════════════════════════════════════════════════════════════
-- 0015 — The house's journal (brief §2.7)
-- Who published what, and when — useful the day something goes out
-- too early. Internal material: the couple never reads this table.
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  actor text not null default '',
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  -- A sweep that was reverted keeps its trace, marked, never erased.
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_wedding_idx
  on activity_log (wedding_id, created_at desc);

alter table activity_log enable row level security;

do $$ begin
  create policy "team full" on activity_log
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
