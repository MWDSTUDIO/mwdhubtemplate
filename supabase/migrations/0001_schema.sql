-- ═══════════════════════════════════════════════════════════════════
-- The Inner House — schema
-- One Supabase project, every MWD wedding. Nothing hard-coded per couple:
-- all client-specific content lives here. Draft/published separation is
-- in the data model, never in CSS.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── enums ───────────────────────────────────────────────────────────
create type app_role as enum ('client', 'coordinator', 'team');
create type publish_status as enum ('draft', 'published');
create type attention_status as enum ('awaiting_word', 'at_leisure', 'attended');
create type board_type as enum
  ('global', 'floral', 'tablescape', 'welcome', 'cocktail', 'dinner', 'reception', 'farewell', 'stationery');
create type board_status as enum ('in_creation', 'to_review', 'approved');
create type sub_board_kind as enum ('rental', 'stationery', 'invitations', 'day_of');
create type vendor_stage as enum ('scouted', 'contacted', 'proposal', 'contracted');
create type vendor_doc_type as enum ('proposal', 'contract', 'invoice');
create type rsvp_status as enum ('pending', 'confirmed', 'declined');
create type message_channel as enum ('client', 'teamwork');
create type correspondence_kind as enum ('save_the_date', 'travel_booklet', 'week_of_letter', 'custom');
create type proposal_status as enum ('sent', 'confirmed', 'declined');

-- ── weddings & people ───────────────────────────────────────────────
create table weddings (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  couple_display_name text not null,          -- "Camille & Alexander"
  partner_a text not null,
  partner_b text not null,
  destination text not null,                  -- "Provence"
  venue text,                                 -- "Château …"
  date_start date,
  date_end date,
  timezone text not null default 'Europe/Paris',
  default_locale text not null default 'en',
  languages text[] not null default '{en}',
  entrance_media_url text,                    -- background photo, provided later by Estelle
  entrance_plaque_url text,                   -- hi-def logo file when provided
  budget_total numeric,
  drive_folder_shared_id text,
  drive_folder_internal_id text,
  first_toast_at timestamptz,                 -- countdown target
  created_at timestamptz not null default now()
);

-- The Desk project brief — permanent context of every agent for this
-- wedding. Internal: its own table so no client select can ever touch it.
create table wedding_briefs (
  wedding_id uuid primary key references weddings on delete cascade,
  body text not null,
  updated_at timestamptz not null default now()
);

create table wedding_events (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  name text not null,                         -- Welcome, Rehearsal, Cocktail…
  event_date date,
  sort int not null default 0
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  role app_role not null default 'client',
  is_principal boolean not null default false,   -- Estelle
  is_teamwork boolean not null default false,    -- Estelle + Jordane
  locale text not null default 'en',
  timezone text not null default 'Europe/Paris',
  created_at timestamptz not null default now()
);

create table wedding_members (
  wedding_id uuid not null references weddings on delete cascade,
  profile_id uuid not null references profiles on delete cascade,
  relation text not null check (relation in ('couple', 'coordinator')),
  primary key (wedding_id, profile_id)
);

-- ── timeline ────────────────────────────────────────────────────────
create table timeline_milestones (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  month date not null,                        -- first of month
  label text not null,
  done boolean not null default false,
  status publish_status not null default 'draft',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table monthly_notes (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  month date not null,
  subjects_raw text,                          -- Estelle's raw subjects (internal)
  composed_text text,                         -- the agent's note, house voice
  preview_text text,                          -- short preview for coming months
  status publish_status not null default 'draft',
  unique (wedding_id, month)
);

create table attentions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  title text not null,
  due_date date,
  status attention_status not null default 'at_leisure',
  milestone_id uuid references timeline_milestones on delete set null,
  created_at timestamptz not null default now()
);

create table internal_tasks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  assignee text,
  title text not null,
  due_date date,
  done boolean not null default false
);

-- ── design studio ───────────────────────────────────────────────────
create table boards (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  type board_type not null,
  title text not null,
  subtitle text,
  status board_status not null default 'in_creation',
  palette text[] not null default '{}',       -- hex codes; the app renders squares
  cover_url text,
  sort int not null default 0,
  unique (wedding_id, type)
);

create table sub_boards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  kind sub_board_kind not null,
  title text,
  status board_status not null default 'in_creation',
  content jsonb not null default '{}'::jsonb
);

create table board_comments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  author_id uuid not null references profiles,
  kind text not null default 'comment' check (kind in ('comment', 'approval')),
  body text,
  created_at timestamptz not null default now()
);

-- ── vendors & documents ─────────────────────────────────────────────
create table vendors (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  name text not null,
  category text not null,                     -- Floral, Catering, Music, Image…
  stage vendor_stage not null default 'scouted',
  client_visible boolean not null default true,
  created_at timestamptz not null default now()
);

-- Internal vendor notes live apart so a client select can never touch them.
create table vendor_internal_notes (
  vendor_id uuid primary key references vendors on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  body text
);

create table vendor_documents (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  type vendor_doc_type not null,
  label text not null,                        -- "Proposal v2", "Contract — signed"
  storage_path text,
  extraction jsonb,                           -- agent output: amounts, schedule, terms
  client_visible boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── budget ──────────────────────────────────────────────────────────
create table budget_envelopes (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  label text not null,
  percent numeric,
  sort int not null default 0
);

-- The house's note on an envelope, signed "— Estelle". Separate table so
-- a draft note is row-invisible to clients, not merely CSS-hidden.
create table envelope_notes (
  envelope_id uuid primary key references budget_envelopes on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  body text not null,
  status publish_status not null default 'draft'
);

create table budget_lines (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  envelope_id uuid references budget_envelopes on delete set null,
  vendor_id uuid references vendors on delete set null,
  label text not null,
  budgeted numeric,
  committed numeric,
  committed_note text,                        -- "Proposal received", "In discussion"
  paid numeric not null default 0,
  next_payment_label text,
  status publish_status not null default 'draft',
  sort int not null default 0
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  budget_line_id uuid references budget_lines on delete cascade,
  label text not null,
  amount numeric not null,
  due_date date,
  paid_at date,
  reminder_sent_at timestamptz
);

-- Estelle's margins & method — the agent consults, never reveals.
create table internal_budget_notes (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ── guests ──────────────────────────────────────────────────────────
create table guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  title text,                                 -- Mr. and Mrs. / Monsieur et Madame / The Honourable…
  first_names text,
  surname text,
  invitation_line text,                       -- as it appears on the envelope (stationery conventions)
  address text,
  locale text not null default 'en',          -- language of correspondence
  travel text,                                -- arrivals, departures, stay wishes
  dietary text,
  stationer_flag text,                        -- the stationer's eye remark, if any
  created_at timestamptz not null default now()
);

create table guest_events (
  guest_id uuid not null references guests on delete cascade,
  event_id uuid not null references wedding_events on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  rsvp rsvp_status not null default 'pending',
  primary key (guest_id, event_id)
);

create table hotel_blocks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  hotel text not null,
  rooms_held int not null,
  cutoff_date date,
  booking_code text,
  active boolean not null default true
);

-- The rooming list opens only on Estelle's action.
create table rooming_list_state (
  wedding_id uuid primary key references weddings on delete cascade,
  opened boolean not null default false,
  opened_at timestamptz,
  opened_by uuid references profiles
);

create table rooming_entries (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  guest_id uuid references guests on delete set null,
  hotel text,
  room text,
  nights text,
  billing text not null default 'house' check (billing in ('house', 'guest'))
);

-- ── communication ───────────────────────────────────────────────────
create table correspondence (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  kind correspondence_kind not null,
  title text not null,
  body_by_locale jsonb not null default '{}'::jsonb,   -- {en: "...", fr: "..."}
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent')),
  scheduled_label text,
  sent_at timestamptz
);

create table hospitality_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  label text not null,
  scope text,
  status text not null default 'to_come',
  sort int not null default 0
);

-- ── documents (Drive mirror for listing) ────────────────────────────
create table documents (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  label text not null,
  url text,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── messages ────────────────────────────────────────────────────────
create table messages (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  channel message_channel not null default 'client',
  author_id uuid not null references profiles,
  body text not null,
  created_at timestamptz not null default now()
);

-- ── forms ───────────────────────────────────────────────────────────
create table forms (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  title text not null,
  status text not null default 'awaiting' check (status in ('completed', 'awaiting', 'to_come')),
  due_label text,
  schema jsonb not null default '[]'::jsonb,
  sort int not null default 0
);

create table form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  submitted_by uuid references profiles,
  data jsonb not null default '{}'::jsonb,
  agent_reply text,                           -- pre-written reply in the house's voice
  reply_status text not null default 'draft' check (reply_status in ('draft', 'sent')),
  created_at timestamptz not null default now()
);

-- ── scheduling (propose a moment) ───────────────────────────────────
create table availability_proposals (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  proposed_by uuid references profiles,
  duration_minutes int not null default 30 check (duration_minutes in (30, 60)),
  slots jsonb not null default '[]'::jsonb,   -- [{date: "2026-08-04", time: "09:30"}]
  status proposal_status not null default 'sent',
  confirmed_slot jsonb,
  calendar_event_id text,
  meet_url text,
  created_at timestamptz not null default now()
);

-- ── the wedding days ────────────────────────────────────────────────
create table run_sheets (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  event_id uuid references wedding_events on delete cascade,
  title text not null,
  items jsonb not null default '[]'::jsonb    -- [{time: "15:00", label: "…"}]
);

create table contact_sheets (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  rows jsonb not null default '[]'::jsonb     -- [{vendor, on_site, reach}]
);

-- ── teamwork ────────────────────────────────────────────────────────
create table call_preparations (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  call_date date,
  points jsonb not null default '[]'::jsonb,
  brief text                                  -- agent-drafted brief
);

-- ── the vault (Estelle only — RLS-locked, not merely hidden) ────────
create table contracts_vault (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid references weddings on delete cascade,
  label text not null,
  storage_path text,
  schedule_label text,
  instalments jsonb not null default '[]'::jsonb,  -- [{label, amount, due_date, paid}]
  created_at timestamptz not null default now()
);

-- Hashed access codes. scope 'teamwork' = shared code (Estelle + Jordane);
-- scope 'vault' = Estelle's personal code. Verified server-side only —
-- no RLS policy grants any read to any role.
create table access_codes (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('teamwork', 'vault')),
  profile_id uuid references profiles on delete cascade,
  code_hash text not null,
  unique (scope, profile_id)
);

-- ── notifications ───────────────────────────────────────────────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid references weddings on delete cascade,
  recipient_id uuid not null references profiles on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

-- ── indexes ─────────────────────────────────────────────────────────
create index on wedding_members (profile_id);
create index on timeline_milestones (wedding_id, month);
create index on monthly_notes (wedding_id, month);
create index on attentions (wedding_id);
create index on boards (wedding_id);
create index on vendors (wedding_id);
create index on budget_lines (wedding_id);
create index on payments (wedding_id, due_date);
create index on guests (wedding_id);
create index on messages (wedding_id, channel, created_at);
create index on notifications (recipient_id, read_at);

-- ── realtime ────────────────────────────────────────────────────────
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table notifications;
