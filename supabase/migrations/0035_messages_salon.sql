-- ═══════════════════════════════════════════════════════════════════
-- 0035 — The Messages salon grows up (validated mockup):
-- · a message may carry a filed photo (attachment_path — the single
--   original lives in storage, served through a judged door);
-- · a message can be WITHDRAWN by its author — a quiet trace stays
--   ("Message retiré"), nothing is deleted, nothing edited;
-- · authors gain the UPDATE right on their OWN lines (the only
--   mutation the UI offers is the withdrawal).
-- Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

alter table messages add column if not exists attachment_path text;
alter table messages add column if not exists withdrawn_at timestamptz;

drop policy if exists "author amends own" on messages;
create policy "author amends own" on messages
  for update using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- ── control ─────────────────────────────────────────────────────────
select 'messages' as ready, count(*) from messages
union all
select 'with_photo', count(*) from messages where attachment_path is not null
union all
select 'withdrawn', count(*) from messages where withdrawn_at is not null;
