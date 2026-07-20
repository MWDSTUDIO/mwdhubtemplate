-- ═══════════════════════════════════════════════════════════════════
-- Development seed — the fictional "Camille & Alexander" wedding from
-- the validated mockup. DEMO DATA ONLY: the application never hard-codes
-- a couple; every real wedding is instantiated from The Desk.
--
-- Demo accounts (password for all: innerhouse):
--   estelle@demo.mwd     team · principal · teamwork   vault code 2711
--   jordane@demo.mwd     team · teamwork               teamwork code 0909
--   camille@demo.mwd     client (couple)
--   alexander@demo.mwd   client (couple)
--   coord@demo.mwd       coordinator (The Wedding Days only)
-- ═══════════════════════════════════════════════════════════════════

-- ── auth users (local/dev only) ─────────────────────────────────────
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'estelle@demo.mwd',
   crypt('innerhouse', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'jordane@demo.mwd',
   crypt('innerhouse', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'camille@demo.mwd',
   crypt('innerhouse', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'alexander@demo.mwd',
   crypt('innerhouse', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000005',
   'authenticated', 'authenticated', 'coord@demo.mwd',
   crypt('innerhouse', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities
  (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', now(), now(), now()
from auth.users u where u.email like '%@demo.mwd';

-- ── profiles ────────────────────────────────────────────────────────
insert into profiles (id, full_name, role, is_principal, is_teamwork, locale) values
  ('a0000000-0000-0000-0000-000000000001', 'Estelle',   'team', true,  true,  'en'),
  ('a0000000-0000-0000-0000-000000000002', 'Jordane',   'team', false, true,  'en'),
  ('a0000000-0000-0000-0000-000000000003', 'Camille',   'client', false, false, 'en'),
  ('a0000000-0000-0000-0000-000000000004', 'Alexander', 'client', false, false, 'en'),
  ('a0000000-0000-0000-0000-000000000005', 'Louise',    'coordinator', false, false, 'fr');

-- ── access codes (demo: teamwork 0909 · vault 2711) ─────────────────
insert into access_codes (scope, profile_id, code_hash) values
  ('teamwork', null, crypt('0909', gen_salt('bf'))),
  ('vault', 'a0000000-0000-0000-0000-000000000001', crypt('2711', gen_salt('bf')));

-- ── the wedding ─────────────────────────────────────────────────────
insert into weddings
  (id, slug, couple_display_name, partner_a, partner_b, destination, venue,
   date_start, date_end, timezone, default_locale, languages,
   budget_total, first_toast_at)
values
  ('11111111-1111-1111-1111-111111111111', 'camille-alexander',
   'Camille & Alexander', 'Camille', 'Alexander', 'Provence', 'Château',
   '2027-09-10', '2027-09-12', 'Europe/Paris', 'en', '{en,fr}',
   720000, '2027-09-10 19:00:00+02');

insert into wedding_briefs (wedding_id, body) values
  ('11111111-1111-1111-1111-111111111111',
   'Camille & Alexander — multi-day wedding at a château in Provence, September 10–12 2027, ~140 international guests (EN/FR). The couple: understated, garden-loving, allergic to ostentation; they want the weekend to feel like a house opened to friends, not a production. Constraints: Alexander''s family travels from London; Camille''s grandmother cannot climb stairs — ceremony and dinner at garden level. Parti pris: linen and light, olive trees, brass candlelight; no spectacle for its own sake except a single fireworks finale. Never propose anything that reads as showy. Budget €720,000 total.');

insert into wedding_members (wedding_id, profile_id, relation) values
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000003', 'couple'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000004', 'couple'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005', 'coordinator');

insert into wedding_events (id, wedding_id, name, event_date, sort) values
  ('22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Welcome',   '2027-09-10', 1),
  ('22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Rehearsal', '2027-09-10', 2),
  ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cocktail',  '2027-09-11', 3),
  ('22222222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Dinner',    '2027-09-11', 4),
  ('22222222-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Reception', '2027-09-11', 5),
  ('22222222-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Farewell',  '2027-09-12', 6);

-- ── timeline ────────────────────────────────────────────────────────
insert into timeline_milestones (wedding_id, month, label, done, status, sort) values
  ('11111111-1111-1111-1111-111111111111', '2026-06-01', 'Creative direction & scope budget approved', true,  'published', 1),
  ('11111111-1111-1111-1111-111111111111', '2026-07-01', 'Global design presented',                    true,  'published', 2),
  ('11111111-1111-1111-1111-111111111111', '2026-09-01', 'Boards by moment · venue contracts',         false, 'published', 3),
  ('11111111-1111-1111-1111-111111111111', '2026-12-01', 'Stationery — invitations in creation',       false, 'published', 4),
  ('11111111-1111-1111-1111-111111111111', '2027-03-01', 'Invitations sent · RSVP opens',              false, 'published', 5),
  ('11111111-1111-1111-1111-111111111111', '2027-06-01', 'Day-of stationery · seating plans',          false, 'published', 6),
  ('11111111-1111-1111-1111-111111111111', '2027-09-01', 'Welcome · Cocktail · Dinner · Farewell',     false, 'published', 7);

insert into monthly_notes (wedding_id, month, subjects_raw, composed_text, status) values
  ('11111111-1111-1111-1111-111111111111', '2026-07-01',
   'château grounds walk with florist, tasting in Aix, first invitation proof',
   'July is a month of gardens and letters: we are walking the château''s grounds with Maison L. to place your cocktail among the olive trees, tasting our way toward your menu in Aix, and watching the first proof of your invitations take shape at the press.',
   'published');

insert into monthly_notes (wedding_id, month, preview_text, status) values
  ('11111111-1111-1111-1111-111111111111', '2026-08-01', 'Tasting · invitation proof · floral direction settled', 'published'),
  ('11111111-1111-1111-1111-111111111111', '2026-09-01', 'Venue contracts · boards by moment', 'published'),
  ('11111111-1111-1111-1111-111111111111', '2026-10-01', 'Rentals chosen · château second instalment', 'published');

insert into attentions (wedding_id, title, due_date, status) values
  ('11111111-1111-1111-1111-111111111111', 'Approve the cocktail floral board', '2026-07-28', 'awaiting_word'),
  ('11111111-1111-1111-1111-111111111111', 'Send the last 28 guest addresses',  '2026-08-10', 'at_leisure'),
  ('11111111-1111-1111-1111-111111111111', 'Confirm the tasting date of August 4', null,      'attended');

insert into internal_tasks (wedding_id, assignee, title, due_date) values
  ('11111111-1111-1111-1111-111111111111', 'Jordane', 'Rental scouting — dinner furniture, 3 suppliers to compare', null),
  ('11111111-1111-1111-1111-111111111111', 'Estelle', 'Brief the calligrapher on menus, before Aug 10', '2026-08-10'),
  ('11111111-1111-1111-1111-111111111111', 'Estelle', 'Follow up on the orchestra contract', '2026-08-21');

-- ── design studio ───────────────────────────────────────────────────
insert into boards (id, wedding_id, type, title, subtitle, status, palette, sort) values
  ('33333333-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'global',
   'A summer evening in Provence — linen and light', null, 'approved', '{}', 0),
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'floral',
   'Floral design', null, 'to_review', '{}', 1),
  ('33333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'tablescape',
   'Tablescape', 'The dinner table, in four tones', 'approved',
   '{#22382B,#fbf8f3,#c9b291,#7A4A2B}', 2),
  ('33333333-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'welcome',
   'Welcome & Rehearsal', null, 'in_creation', '{}', 3),
  ('33333333-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'cocktail',
   'Wedding cocktail', null, 'to_review', '{}', 4),
  ('33333333-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'dinner',
   'Wedding dinner', null, 'in_creation', '{}', 5),
  ('33333333-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'reception',
   'Wedding reception', null, 'in_creation', '{}', 6),
  ('33333333-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'farewell',
   'Farewell', null, 'in_creation', '{}', 7),
  ('33333333-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'stationery',
   'Stationery', 'Invitations & day-of', 'in_creation', '{}', 8);

-- Rental + Stationery sub-boards for each moment board
insert into sub_boards (board_id, wedding_id, kind)
select b.id, b.wedding_id, k.kind::sub_board_kind
from boards b
cross join (values ('rental'), ('stationery')) as k(kind)
where b.type not in ('global', 'stationery');

-- The stationery board declines into invitations / day-of
insert into sub_boards (board_id, wedding_id, kind, title) values
  ('33333333-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'invitations', 'Wedding invitations'),
  ('33333333-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'day_of', 'Day-of stationery');

-- ── vendors ─────────────────────────────────────────────────────────
insert into vendors (id, wedding_id, name, category, stage) values
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Maison L. — Flowers',     'Floral',   'contracted'),
  ('44444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Atelier R. — Catering',   'Catering', 'proposal'),
  ('44444444-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Duo C. — Orchestra',      'Music',    'contacted'),
  ('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Studio M. — Photography', 'Image',    'scouted');

insert into vendor_documents (vendor_id, wedding_id, type, label) values
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'proposal', 'Proposal v2'),
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'contract', 'Contract — signed'),
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'invoice',  'Invoice #1 — paid'),
  ('44444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'proposal', 'Proposal v1 — in review');

insert into vendor_internal_notes (vendor_id, wedding_id, body) values
  ('44444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Second rental supplier 15% under, same linen quality — margin goes to the tablescape if the tasting runs long.');

-- ── budget ──────────────────────────────────────────────────────────
insert into budget_envelopes (id, wedding_id, label, percent, sort) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Venues & accommodation', 28, 1),
  ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Catering & wines', 24, 2),
  ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Design, floral & rentals', 22, 3),
  ('55555555-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Music & entertainment', 10, 4),
  ('55555555-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Fireworks — added at your request', 3, 5),
  ('55555555-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Image · Stationery · Beauty', 7, 6),
  ('55555555-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Production & contingency', 6, 7);

insert into envelope_notes (envelope_id, wedding_id, body, status) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'In Provence, the château is never a mere address: it is your home for three days. This envelope holds the estate in exclusivity, the rooms we keep for your closest, and the quiet of having nowhere else to be.', 'published'),
  ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Three days of tables — from the welcome rosé to the farewell brunch. We invest here in hands, not volume: a brigade that cooks in place, wines chosen with the menu, never after it.', 'published');

insert into budget_lines
  (wedding_id, envelope_id, vendor_id, label, budgeted, committed, committed_note, paid, next_payment_label, status, sort)
values
  ('11111111-1111-1111-1111-111111111111', '55555555-0000-0000-0000-000000000001', null,
   'Château — Venues', 200000, 195000, null, 97500, '2nd instalment €48,750 · Oct 1', 'published', 1),
  ('11111111-1111-1111-1111-111111111111', '55555555-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001',
   'Maison L. — Flowers', 160000, 152000, null, 45600, '30 % deposit · Sep 15', 'published', 2),
  ('11111111-1111-1111-1111-111111111111', '55555555-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002',
   'Atelier R. — Catering', 175000, null, 'Proposal received', 0, 'After the Aug 4 tasting', 'published', 3),
  ('11111111-1111-1111-1111-111111111111', '55555555-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000003',
   'Duo C. — Orchestra', 70000, null, 'In discussion', 0, null, 'published', 4),
  ('11111111-1111-1111-1111-111111111111', '55555555-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000004',
   'Studio M. — Photography', 45000, null, null, 0, null, 'published', 5),
  ('11111111-1111-1111-1111-111111111111', '55555555-0000-0000-0000-000000000006', null,
   'Stationery', 28000, 26000, null, 13000, 'Balance on delivery · Dec', 'published', 6);

insert into payments (wedding_id, budget_line_id, label, amount, due_date)
select '11111111-1111-1111-1111-111111111111', id, '2nd instalment — Château', 48750, '2026-10-01'
from budget_lines where label = 'Château — Venues';
insert into payments (wedding_id, budget_line_id, label, amount, due_date)
select '11111111-1111-1111-1111-111111111111', id, '30 % deposit — Maison L.', 45600, '2026-09-15'
from budget_lines where label = 'Maison L. — Flowers';

insert into internal_budget_notes (wedding_id, body) values
  ('11111111-1111-1111-1111-111111111111',
   'Floral committed €8,000 under envelope — keep quiet; margin earmarked for the dinner tablescape. Catering: do not announce the proposal before the Aug 4 tasting. Orchestra ceiling €70k, opening at €62k.');

-- ── guests ──────────────────────────────────────────────────────────
insert into guests (id, wedding_id, title, first_names, surname, invitation_line, address, locale, travel) values
  ('66666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Monsieur et Madame', 'Henri and Louise', 'de Valcourt',
   'Monsieur et Madame Henri de Valcourt', '14 rue de Varenne, 75007 Paris', 'fr',
   'Fri → Sun · Château'),
  ('66666666-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'The Honourable', 'James', 'Ashworth',
   'The Honourable James Ashworth and Mrs. Ashworth', 'Belgravia, London', 'en',
   'Sat · Avignon TGV shuttle'),
  ('66666666-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Doctor and Mrs.', 'Paul', 'Reynaud',
   'Doctor and Mrs. Paul Reynaud', 'Lyon', 'en', 'To arrange');

update guests set stationer_flag =
  'British usage calls for "The Honourable James Ashworth and Mrs. Ashworth" rather than "Mr. and Mrs. James Ashworth" — James being the son of a viscount. Corrected on the envelope and the seating chart.'
where id = '66666666-0000-0000-0000-000000000002';

insert into guest_events (guest_id, event_id, wedding_id, rsvp) values
  ('66666666-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'confirmed'),
  ('66666666-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'confirmed'),
  ('66666666-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'confirmed'),
  ('66666666-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'pending'),
  ('66666666-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'pending'),
  ('66666666-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'pending');

-- ── accommodation ───────────────────────────────────────────────────
insert into hotel_blocks (wedding_id, hotel, rooms_held, cutoff_date) values
  ('11111111-1111-1111-1111-111111111111', 'Château estate rooms', 24, '2027-06-01'),
  ('11111111-1111-1111-1111-111111111111', 'Hôtel B., village', 18, '2027-06-15');

insert into rooming_list_state (wedding_id, opened) values
  ('11111111-1111-1111-1111-111111111111', false);

-- ── communication ───────────────────────────────────────────────────
insert into correspondence (wedding_id, kind, title, status, scheduled_label, sent_at) values
  ('11111111-1111-1111-1111-111111111111', 'save_the_date', 'Save the date announcement — EN & FR', 'sent', null, '2026-03-01'),
  ('11111111-1111-1111-1111-111111111111', 'travel_booklet', 'Travel & stay booklet', 'scheduled', 'Mar 27', null),
  ('11111111-1111-1111-1111-111111111111', 'week_of_letter', 'The week-of letter — programme, dress notes, weather', 'scheduled', 'Aug 27', null);

insert into hospitality_items (wedding_id, label, scope, status, sort) values
  ('11111111-1111-1111-1111-111111111111', 'Welcome gifts in rooms', 'All staying guests', 'in_creation', 1),
  ('11111111-1111-1111-1111-111111111111', 'Shuttles — Avignon TGV & Marseille airport', 'By arrival slot', 'awaiting_rsvps', 2),
  ('11111111-1111-1111-1111-111111111111', 'Concierge sheet — the weekend at a glance', 'All guests', 'to_come', 3);

-- ── documents ───────────────────────────────────────────────────────
insert into documents (wedding_id, label, internal) values
  ('11111111-1111-1111-1111-111111111111', 'Château contract — signed.pdf', false),
  ('11111111-1111-1111-1111-111111111111', 'Global design board — v3.pdf', false),
  ('11111111-1111-1111-1111-111111111111', 'Weekend timeline — July.pdf', false),
  ('11111111-1111-1111-1111-111111111111', 'Caterer proposals — comparison.xlsx', true),
  ('11111111-1111-1111-1111-111111111111', 'Château scouting notes.docx', true);

-- ── messages ────────────────────────────────────────────────────────
insert into messages (wedding_id, channel, author_id, body) values
  ('11111111-1111-1111-1111-111111111111', 'client', 'a0000000-0000-0000-0000-000000000003',
   'We adore the tablescape board! One question on the candlesticks — brass or silver?'),
  ('11111111-1111-1111-1111-111111111111', 'client', 'a0000000-0000-0000-0000-000000000001',
   'Brass, without hesitation: it warms the table at sunset and speaks to the natural linen. I''ll show you two references tomorrow.'),
  ('11111111-1111-1111-1111-111111111111', 'client', 'a0000000-0000-0000-0000-000000000004',
   'Perfect. And for the tasting on August 4 — may my mother join us?'),
  ('11111111-1111-1111-1111-111111111111', 'teamwork', 'a0000000-0000-0000-0000-000000000002',
   'The second rental supplier came back — 15% under, same linen quality. I''d take it.'),
  ('11111111-1111-1111-1111-111111111111', 'teamwork', 'a0000000-0000-0000-0000-000000000001',
   'Take it. Keep the margin quiet for now — it goes to the tablescape if the tasting runs long.');

-- ── forms ───────────────────────────────────────────────────────────
insert into forms (wedding_id, title, status, due_label, sort) values
  ('11111111-1111-1111-1111-111111111111', 'Your preferences & your story', 'completed', null, 1),
  ('11111111-1111-1111-1111-111111111111', 'Guest list & accommodation', 'awaiting', null, 2),
  ('11111111-1111-1111-1111-111111111111', 'Menu choices & allergies', 'to_come', 'March 2027', 3);

-- ── the wedding days ────────────────────────────────────────────────
insert into run_sheets (wedding_id, event_id, title, items) values
  ('11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000004',
   'Run sheet — Wedding dinner · Sep 11',
   '[{"time":"15:00","label":"Rentals delivered — tables set by 17:30"},
     {"time":"18:15","label":"Florals placed · candles lit at dusk"},
     {"time":"19:30","label":"Guests seated — first course at 20:00"},
     {"time":"23:00","label":"Transition to reception — orchestra moves"}]');

insert into contact_sheets (wedding_id, rows) values
  ('11111111-1111-1111-1111-111111111111',
   '[{"vendor":"Maison L. — Flowers","on_site":"14:00","reach":"On the sheet"},
     {"vendor":"Atelier R. — Catering","on_site":"13:00","reach":"On the sheet"},
     {"vendor":"Duo C. — Orchestra","on_site":"18:00","reach":"On the sheet"}]');

-- ── teamwork ────────────────────────────────────────────────────────
insert into call_preparations (wedding_id, call_date, points) values
  ('11111111-1111-1111-1111-111111111111', '2026-07-24',
   '["Floral board: present the two cocktail directions, recommend the airy one",
     "Budget: announce the caterer proposal after the tasting, not before",
     "Guests: nudge the missing 28 RSVPs, gently"]');

-- ── the vault ───────────────────────────────────────────────────────
insert into contracts_vault (wedding_id, label, schedule_label, instalments) values
  ('11111111-1111-1111-1111-111111111111', 'MWD production agreement — signed', '4 instalments',
   '[{"label":"Signature","amount":180000,"due_date":"2026-05-01","paid":true},
     {"label":"Second","amount":180000,"due_date":"2026-11-01","paid":false},
     {"label":"Third","amount":180000,"due_date":"2027-04-01","paid":false},
     {"label":"Balance","amount":180000,"due_date":"2027-08-15","paid":false}]');
