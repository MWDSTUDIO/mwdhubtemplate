-- ═══════════════════════════════════════════════════════════════════
-- 0018 — Programmable payment reminders (notifications brief, Part I)
--
-- What it does:
--   · payment_reminders — as many reminders as the house wishes per
--     instalment: an offset from the due date (negative = before,
--     positive = after) OR a fixed date, a channel (email · in_app ·
--     both), an optional label, and sent_at once it has left.
--   · reminder_sends — the send ledger: every departure is recorded
--     (which reminder, which instalment, which address, which day);
--     a partial unique index guarantees the same reminder never
--     leaves twice on the same channel. Failures and abandonments
--     are rows too, so "reminder not sent" can be surfaced in-app.
--   · weddings gains the per-wedding settings: the default reminder
--     set applied to every new instalment, the email_banking_disclosure
--     level (link · partial · full — brief §2), the sender identity
--     (display name + Reply-To), and the mandatory first-send preview
--     approval (nothing emails before Estelle has seen it).
--
-- Why: the fixed three-moment calendar was too rigid; Estelle decides
-- how many reminders, and when. All locks are server-side.
--
-- If not run: the reminders desk shows a held message; nothing sends,
-- nothing breaks. Instalments and notices keep working as before.
--
-- Rollback note: additive only — to step back, drop the two tables
--   (drop table reminder_sends; drop table payment_reminders;) and
--   ignore the new weddings columns; no existing data is touched.
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. the reminders themselves ─────────────────────────────────────
create table if not exists payment_reminders (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  payment_id uuid not null references payments on delete cascade,
  -- one of the two: an offset from due_date, or a fixed date.
  offset_days int,
  fixed_date date,
  channel text not null default 'both'
    check (channel in ('email', 'in_app', 'both')),
  label text,
  sent_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  constraint payment_reminders_when check (
    offset_days is not null or fixed_date is not null
  )
);

create index if not exists payment_reminders_payment_idx
  on payment_reminders (payment_id);
create index if not exists payment_reminders_wedding_idx
  on payment_reminders (wedding_id, sent_at);

alter table payment_reminders enable row level security;

do $$ begin
  create policy "team full" on payment_reminders
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;
-- No client policy: reminders are the house's machinery. The couple
-- receives the word (email / notification), never the mechanism.

-- ── 2. the send ledger ───────────────────────────────────────────────
create table if not exists reminder_sends (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  reminder_id uuid not null references payment_reminders on delete cascade,
  payment_id uuid not null references payments on delete cascade,
  channel text not null check (channel in ('email', 'in_app')),
  -- the addresses the word left for; 'in_app' for the hub channel.
  recipient text not null default '',
  sent_on date not null,
  status text not null default 'sent'
    check (status in ('sent', 'failed', 'abandoned')),
  attempt int not null default 1,
  error text,
  subject text,
  -- same-day sends grouped into one email share a group_key;
  -- the Gmail ids let successive reminders join the same thread.
  group_key text,
  gmail_message_id text,
  gmail_thread_id text,
  rfc822_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists reminder_sends_wedding_idx
  on reminder_sends (wedding_id, created_at desc);
create index if not exists reminder_sends_payment_idx
  on reminder_sends (payment_id, status);

-- The same reminder never leaves twice on the same channel.
create unique index if not exists reminder_sends_once
  on reminder_sends (reminder_id, channel)
  where status = 'sent';

alter table reminder_sends enable row level security;

do $$ begin
  create policy "team full" on reminder_sends
    for all using (app.is_team()) with check (app.is_team());
exception when duplicate_object then null; end $$;

-- ── 3. the wedding's own settings ────────────────────────────────────
alter table weddings
  -- the default set applied to every new instalment:
  -- [{ "offset_days": -30, "channel": "both", "label": "" }, …]
  add column if not exists reminder_defaults jsonb not null default '[]'::jsonb,
  -- what the reminder email carries (brief §2) — journaled on change.
  add column if not exists email_banking_disclosure text not null default 'link',
  -- the sender identity: the hand that follows this wedding.
  add column if not exists reminder_sender_name text,
  add column if not exists reminder_reply_to text,
  -- mandatory preview before a wedding's first email leaves.
  add column if not exists reminder_preview_approved_at timestamptz,
  add column if not exists reminder_preview_approved_by text;

do $$ begin
  alter table weddings
    add constraint weddings_banking_disclosure
    check (email_banking_disclosure in ('link', 'partial', 'full'));
exception when duplicate_object then null; end $$;
