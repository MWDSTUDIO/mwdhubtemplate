# The Inner House — Madame Wedding Design

## What it is

The client portal (hub) of Madame Wedding Design, a Parisian house of wedding
planning and production for an international UHNW clientele. One multi-wedding
application: every couple is instantiated from The Desk in minutes; nothing is
hard-coded for a client. "Camille & Alexander" is fictional seed data only.

## Register

product — app UI. Design serves the product. Basecamp-grade functional
clarity, carried everywhere by the aesthetic of the house.

## Platform

web — Next.js 15 App Router, installable PWA (iPhone/Android, no app store).

## Audience & scene

Couples preparing a multi-day destination wedding, opening the hub at night on
a phone or over breakfast on a laptop; and the two heads of the house working
in it all day. Warm interior light, unhurried. The hub is "the inner wing" of
the house: quiet, assured, never software-loud.

## Voice

Sober, precise, warm without effusion. The word "luxury" is forbidden
everywhere. MWD is always "a Parisian house of wedding planning and
production" — never studio, agency, company. Client tasks are "attentions"
(statuses: Awaiting your word / At your leisure / Attended to) — never
"task", "to do", "pending" on the client side.

## Design system (committed brand — identity preservation wins)

- Hub palette: cream `#fbf8f3` body, hunter green `#22382B`, hairlines
  champagne `#c9b291` only, parchment `#f2efe4`, secondary ink `#5f6a5a`.
  Expressed as OKLCH tokens in `src/app/globals.css`.
- Type: Cormorant Garamond (display, house italics) + Jost (UI).
- Non-negotiables: contrast ≥ 4.5:1, OKLCH colors, no gradient text, no
  glassmorphism, no identical card grids, no repeated uppercase eyebrow on
  every section, no side-stripe borders, ease-out expo motion without bounce,
  `prefers-reduced-motion` honored everywhere.
- Entrance: hunter-green double door split by a champagne hairline, MWD
  plaque, staged copy, doors part in 1.9s cubic-bezier(.77,0,.18,1).

## Access levels

1 Client (their published wedding only) · 2 Coordinator (The Wedding Days of
assigned weddings only) · 3 Team (all, incl. drafts + Madame) · 4 Teamwork 🔑
(Estelle + Jordane, shared code) · 5 The Vault 🔒 (Estelle alone, personal
code, enforced server-side). Draft/published separation lives in the database,
never in CSS.
