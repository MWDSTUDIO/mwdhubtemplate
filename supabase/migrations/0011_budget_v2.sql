-- ═══════════════════════════════════════════════════════════════════
-- Budget v2 — one paste, the whole engine.
--   1. Sub-lines of a quote, grouped by event, rolling up on their own.
--   2. Payments made real: currency, method, payer, refundable flag,
--      banking reveal, notification trace.
--   3. Nested lines (credits under a parent, the CdB case).
--   4. Envelopes with priority and lock, for the scope's redistribution.
--   5. Vendor banking, encrypted at rest, team-only.
--   6. The risk buffer, kept as in the house's Excel.
--   7. Notes carry the raw word and the refined one (client language).
--   8. Sophie & Gordon loaded as the test wedding.
-- Safe to run twice: everything is "if not exists" / "on conflict".
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. sub-lines ─────────────────────────────────────────────────────
create table if not exists budget_line_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  budget_line_id uuid not null references budget_lines on delete cascade,
  event_label text,                    -- "Rehearsal dinner — April 30"
  label text not null,
  qty numeric,
  unit_price numeric,
  total_ht numeric,
  vat_pct numeric,
  total_ttc numeric,
  notes text,
  sort int not null default 0
);
create index if not exists bli_line_idx on budget_line_items (budget_line_id, sort);
alter table budget_line_items enable row level security;
drop policy if exists "team full" on budget_line_items;
create policy "team full" on budget_line_items
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "couple read" on budget_line_items;
create policy "couple read" on budget_line_items
  for select using (app.couple_of(wedding_id));

-- ── 2. payments made real ────────────────────────────────────────────
alter table payments add column if not exists currency text not null default 'EUR';
alter table payments add column if not exists amount_eur numeric;      -- equivalent, kept by Madame
alter table payments add column if not exists method text;             -- Bank transfer, card, cash…
alter table payments add column if not exists payer text;              -- who settles it
alter table payments add column if not exists refundable boolean not null default false;
alter table payments add column if not exists reveal_banking boolean not null default false;
alter table payments add column if not exists notified_at timestamptz;

-- ── 3. nested lines ──────────────────────────────────────────────────
alter table budget_lines add column if not exists parent_line_id uuid references budget_lines on delete cascade;
alter table budget_lines add column if not exists line_kind text not null default 'line'
  check (line_kind in ('line', 'credit', 'included'));

-- ── 4. envelopes: priority & lock ────────────────────────────────────
alter table budget_envelopes add column if not exists priority text not null default 'standard'
  check (priority in ('high', 'standard'));
alter table budget_envelopes add column if not exists locked boolean not null default false;

-- ── 5. vendor banking, encrypted at rest ─────────────────────────────
create table if not exists vendor_banking (
  vendor_id uuid primary key references vendors on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  enc text not null,                   -- AES-256-GCM, key held by the server
  updated_at timestamptz not null default now()
);
alter table vendor_banking enable row level security;
drop policy if exists "team full" on vendor_banking;
create policy "team full" on vendor_banking
  for all using (app.is_team()) with check (app.is_team());
-- no client policy at all: the couple sees an IBAN only through a page
-- the server renders when a payment carries "reveal_banking".

-- ── 6. the risk buffer ───────────────────────────────────────────────
create table if not exists budget_risks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  label text not null,
  description text,
  exposure numeric,
  probability numeric,                 -- 0–1
  owner text,
  mitigation text,
  sort int not null default 0
);
alter table budget_risks enable row level security;
drop policy if exists "team only" on budget_risks;
create policy "team only" on budget_risks
  for all using (app.is_team()) with check (app.is_team());

-- ── 7. the raw word and the refined one ──────────────────────────────
alter table envelope_notes add column if not exists body_raw text;
create table if not exists vendor_client_notes (
  vendor_id uuid primary key references vendors on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  body_raw text,                       -- Estelle's own words, internal
  body text,                           -- the house's voice, client language
  status publish_status not null default 'draft',
  updated_at timestamptz not null default now()
);
alter table vendor_client_notes enable row level security;
drop policy if exists "team full" on vendor_client_notes;
create policy "team full" on vendor_client_notes
  for all using (app.is_team()) with check (app.is_team());
drop policy if exists "couple read published" on vendor_client_notes;
create policy "couple read published" on vendor_client_notes
  for select using (app.couple_of(wedding_id) and status = 'published');

-- ═══════════════════════════════════════════════════════════════════
-- 8. Sophie & Gordon — the test wedding (fixed ids, re-runnable)
-- ═══════════════════════════════════════════════════════════════════
insert into weddings (id, slug, couple_display_name, partner_a, partner_b, destination, venue,
                      date_start, date_end, default_locale, languages, budget_total, first_toast_at, timezone)
values ('aaaa5000-0000-0000-0000-000000000001', 'sophie-gordon-test', 'Sophie & Gordon',
        'Sophie', 'Gordon', 'Tuscany', 'Castiglion del Bosco',
        '2026-04-30', '2026-05-02', 'en', '{en}', 1754761, '2026-04-30T19:00:00+02:00', 'Europe/Rome')
on conflict (id) do nothing;

insert into wedding_events (id, wedding_id, name, event_date, sort) values
  ('aaaa5000-0000-0000-0000-00000000e001', 'aaaa5000-0000-0000-0000-000000000001', 'Rehearsal dinner', '2026-04-30', 1),
  ('aaaa5000-0000-0000-0000-00000000e002', 'aaaa5000-0000-0000-0000-000000000001', 'Welcome toast', '2026-04-30', 2),
  ('aaaa5000-0000-0000-0000-00000000e003', 'aaaa5000-0000-0000-0000-000000000001', 'La Notte Prima', '2026-05-01', 3),
  ('aaaa5000-0000-0000-0000-00000000e004', 'aaaa5000-0000-0000-0000-000000000001', 'Wedding day', '2026-05-02', 4)
on conflict (id) do nothing;

insert into vendors (id, wedding_id, name, category, stage) values
  ('aaaa5000-0000-0000-0000-00000000a001', 'aaaa5000-0000-0000-0000-000000000001', 'Castiglion del Bosco', 'Venue', 'contracted'),
  ('aaaa5000-0000-0000-0000-00000000a002', 'aaaa5000-0000-0000-0000-000000000001', 'Blu Notte Eventi', 'Production', 'contracted'),
  ('aaaa5000-0000-0000-0000-00000000a003', 'aaaa5000-0000-0000-0000-000000000001', 'Tuscany Flowers', 'Florals', 'contracted'),
  ('aaaa5000-0000-0000-0000-00000000a004', 'aaaa5000-0000-0000-0000-000000000001', 'ALR Music', 'Entertainment', 'contracted'),
  ('aaaa5000-0000-0000-0000-00000000a005', 'aaaa5000-0000-0000-0000-000000000001', 'Ryan Ray Studio', 'Photography', 'contracted'),
  ('aaaa5000-0000-0000-0000-00000000a006', 'aaaa5000-0000-0000-0000-000000000001', 'Cordes Studio', 'Videography', 'contracted'),
  ('aaaa5000-0000-0000-0000-00000000a007', 'aaaa5000-0000-0000-0000-000000000001', 'Prelude', 'Rentals', 'contracted'),
  ('aaaa5000-0000-0000-0000-00000000a008', 'aaaa5000-0000-0000-0000-000000000001', 'Lupine Letters', 'Stationery', 'contracted')
on conflict (id) do nothing;

-- master lines (with the CdB nested credits, as in the Excel)
insert into budget_lines (id, wedding_id, vendor_id, label, budgeted, committed, paid, next_payment_label, status, sort, parent_line_id, line_kind) values
  ('aaaa5000-0000-0000-0000-00000000b001', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000a001', 'Castiglion del Bosco — Buyout', 773742, 773742, 773742, null, 'published', 1, null, 'line'),
  ('aaaa5000-0000-0000-0000-00000000b002', 'aaaa5000-0000-0000-0000-000000000001', null, 'F&B Minimum Spending (3 nights)', null, 198000, 198000, null, 'published', 2, 'aaaa5000-0000-0000-0000-00000000b001', 'included'),
  ('aaaa5000-0000-0000-0000-00000000b003', 'aaaa5000-0000-0000-0000-000000000001', null, 'Spa & Transport minimums', null, 39210, 39210, null, 'published', 3, 'aaaa5000-0000-0000-0000-00000000b001', 'included'),
  ('aaaa5000-0000-0000-0000-00000000b004', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000a001', 'CdB — Events / F&B (proforma)', null, 448042, 0, 'Final reconciliation', 'published', 4, null, 'line'),
  ('aaaa5000-0000-0000-0000-00000000b005', 'aaaa5000-0000-0000-0000-000000000001', null, 'LESS: F&B minimum credit', null, -198000, -198000, null, 'published', 5, 'aaaa5000-0000-0000-0000-00000000b004', 'credit'),
  ('aaaa5000-0000-0000-0000-00000000b006', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000a002', 'Blu Notte Eventi — Production', null, 308275, 308275, null, 'published', 6, null, 'line'),
  ('aaaa5000-0000-0000-0000-00000000b007', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000a003', 'Tuscany Flowers — Florals', null, 127824, 11650, '1 week pre-event', 'published', 7, null, 'line'),
  ('aaaa5000-0000-0000-0000-00000000b008', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000a004', 'ALR Music — Entertainment', null, 94680, 94680, null, 'published', 8, null, 'line'),
  ('aaaa5000-0000-0000-0000-00000000b009', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000a005', 'Ryan Ray Studio — Photography', null, 52470, 26235, '$31,250 · 2 Apr', 'published', 9, null, 'line'),
  ('aaaa5000-0000-0000-0000-00000000b010', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000a006', 'Cordes Studio — Videography', null, 15500, 7750, '€7,750 · 4 Apr', 'published', 10, null, 'line'),
  ('aaaa5000-0000-0000-0000-00000000b011', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000a007', 'Prelude — Rentals', null, 20537, 20537, null, 'published', 11, null, 'line'),
  ('aaaa5000-0000-0000-0000-00000000b012', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000a008', 'Lupine Letters — Stationery', null, null, 0, null, 'draft', 12, null, 'line'),
  ('aaaa5000-0000-0000-0000-00000000b013', 'aaaa5000-0000-0000-0000-000000000001', null, 'MWD — Planning fee', null, 55000, 40000, '€15,000 · 21 Apr', 'published', 13, null, 'line')
on conflict (id) do nothing;

-- Tuscany Flowers sub-lines, grouped by event (excerpt of the quote)
insert into budget_line_items (id, wedding_id, budget_line_id, event_label, label, qty, unit_price, total_ht, vat_pct, total_ttc, sort) values
  ('aaaa5000-0000-0000-0000-000000001c01', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b007', 'Rehearsal dinner — April 30', 'Centerpieces long tables — white', 16, 320, 5120, 10, 5632, 1),
  ('aaaa5000-0000-0000-0000-000000001c02', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b007', 'Rehearsal dinner — April 30', 'Napkin decor — velvet bow', 50, 8, 400, 0, 400, 2),
  ('aaaa5000-0000-0000-0000-000000001c03', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b007', 'Welcome toast — April 30', 'Bar decor', 2, 720, 1440, 10, 1584, 3),
  ('aaaa5000-0000-0000-0000-000000001c04', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b007', 'Welcome toast — April 30', 'Lanterns for the area', 1, 3000, 3000, 0, 3000, 4),
  ('aaaa5000-0000-0000-0000-000000001c05', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b007', 'Wedding day — May 2', 'Bridal bouquet', 1, 280, 280, 10, 308, 5),
  ('aaaa5000-0000-0000-0000-000000001c06', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b007', 'Wedding day — May 2', 'Bridesmaids bouquets', 9, 120, 1080, 10, 1188, 6),
  ('aaaa5000-0000-0000-0000-000000001c07', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b007', 'Wedding day — May 2', 'Ceremony aisle — flowerbeds', 66, 410, 27060, 10, 29766, 7),
  ('aaaa5000-0000-0000-0000-000000001c08', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b006', 'Global production', 'Crew & technical assistance', 1, 30000, 30000, 22, 36600, 1),
  ('aaaa5000-0000-0000-0000-000000001c09', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b006', 'Welcome toast — April 30', 'Custom green bar', 1, 11750, 11750, 22, 14335, 2)
on conflict (id) do nothing;

-- payment calendar (multi-currency, refundable linen deposit)
insert into payments (id, wedding_id, budget_line_id, label, amount, currency, amount_eur, due_date, method, payer, paid_at, refundable) values
  ('aaaa5000-0000-0000-0000-000000002a01', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b008', 'ALR Music — final 40%', 17612, 'GBP', 20254, '2026-03-01', 'Bank transfer', 'Sophie & Gordon', '2026-03-01', false),
  ('aaaa5000-0000-0000-0000-000000002a02', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b006', 'Blu Notte — 50% deposit', 298275, 'EUR', 298275, '2026-03-01', 'Bank transfer', 'Sophie & Gordon', '2026-03-02', false),
  ('aaaa5000-0000-0000-0000-000000002a03', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b009', 'Ryan Ray — final 50%', 31250, 'USD', 28900, '2026-04-02', 'Bank transfer', 'Sophie & Gordon', null, false),
  ('aaaa5000-0000-0000-0000-000000002a04', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b010', 'Cordes Studio — balance', 7750, 'EUR', 7750, '2026-04-04', 'Bank transfer', 'Sophie & Gordon', null, false),
  ('aaaa5000-0000-0000-0000-000000002a05', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b007', 'Tuscany Flowers — linen deposit', 1520, 'EUR', 1520, '2026-04-20', 'Bank transfer', 'Sophie & Gordon', null, true),
  ('aaaa5000-0000-0000-0000-000000002a06', 'aaaa5000-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-00000000b013', 'MWD — final invoice', 15000, 'EUR', 15000, '2026-04-21', 'Bank transfer', 'Sophie & Gordon', null, false)
on conflict (id) do nothing;

-- the risk buffer, from the Excel
insert into budget_risks (id, wedding_id, label, description, exposure, probability, owner, mitigation, sort) values
  ('aaaa5000-0000-0000-0000-000000003b01', 'aaaa5000-0000-0000-0000-000000000001', 'Weather — outdoor plan B', 'Outdoor events may need backup', 12000, 0.4, 'CdB / MWD', 'Plan B confirmed per event', 1),
  ('aaaa5000-0000-0000-0000-000000003b02', 'aaaa5000-0000-0000-0000-000000000001', 'Open bar consumption', 'Actuals may exceed proforma', 10000, 0.4, 'CdB', 'Monitor via F&B minimum credit', 2),
  ('aaaa5000-0000-0000-0000-000000003b03', 'aaaa5000-0000-0000-0000-000000000001', 'Production additions (BNE)', 'Cocktail sound/lighting TBD', 5000, 0.7, 'MWD / BNE', 'Lock scope before deposit', 3),
  ('aaaa5000-0000-0000-0000-000000003b04', 'aaaa5000-0000-0000-0000-000000000001', 'Currency — USD balances', 'Ryan Ray balance in USD', 2000, 0.4, 'S&G', 'Monitor EUR/USD', 4),
  ('aaaa5000-0000-0000-0000-000000003b05', 'aaaa5000-0000-0000-0000-000000000001', 'Guest count variance', 'F&B proforma on 164 pax', 5000, 0.15, 'MWD / CdB', 'Final RSVPs by April 1', 5)
on conflict (id) do nothing;

select 'budget_line_items' as ready, count(*) from budget_line_items
union all select 'payments v2', count(*) from payments where currency is not null
union all select 'budget_risks', count(*) from budget_risks
union all select 'sophie & gordon', count(*) from weddings where slug = 'sophie-gordon-test';
