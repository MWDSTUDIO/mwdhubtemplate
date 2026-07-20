# The Inner House — Madame Wedding Design

The client portal (hub) of **Madame Wedding Design**, a Parisian house of
wedding planning and production. One multi-wedding application: every new
couple is instantiated from **The Desk** in minutes — nothing is hard-coded
per client. The "Camille & Alexander" data is a fictional development seed.

## Stack

- **Next.js 15** (App Router, TypeScript) — deployed on **Netlify**
  (`@netlify/plugin-nextjs`)
- **Supabase** — Auth, Postgres with strict RLS, Realtime (chats), Storage
- **Claude API** — all agents run in server routes; the key never reaches
  a browser
- **next-intl** — EN (default), FR, ZH, JA, ES; every UI string translated
  in the house's voice
- **PWA** — installable from Safari/Chrome, no app store; web push for chats
- **Google Calendar/Meet + Drive**, **Resend**, **Netlify Forms**

## Getting started

```bash
npm install
cp .env.example .env.local        # fill in Supabase + Anthropic at minimum
npm run dev
```

### Database

Point the Supabase CLI at your project, then:

```bash
supabase db push                  # applies supabase/migrations/*
psql "$DATABASE_URL" -f supabase/seed.sql   # optional demo data (dev only)
```

Demo accounts (password `innerhouse`): `estelle@demo.mwd` (team · principal),
`jordane@demo.mwd` (team · teamwork), `camille@demo.mwd` / `alexander@demo.mwd`
(couple), `coord@demo.mwd` (coordinator). Room codes — Teamwork `0909`,
Vault `2711`. Change all of these before any real use.

### Access model (enforced in Postgres, never in CSS)

| Level | Who | Sees |
|---|---|---|
| 1 Client | the couple | published material of THEIR wedding only |
| 2 Coordinator | day-of coordinators | The Wedding Days of assigned weddings |
| 3 Team | Estelle + collaborators | everything, drafts included, Madame |
| 4 Teamwork 🔑 | Estelle + Jordane | + shared access code |
| 5 The Vault 🔒 | Estelle alone | + her personal code, RLS-locked |

Draft/published separation lives in the data model (`status` columns,
separate tables for internal material). The Team/Client view toggle is a
preview convenience — clients never receive team-only markup at all.

**Barrier tests**: `supabase/tests/access_barriers.sql` runs assertion
checks against a seeded database (client cannot read drafts/internal/vault;
coordinator sees only The Wedding Days; the vault answers to Estelle alone,
even with the right code in the wrong hands). Run with
`psql <db> -f supabase/tests/access_barriers.sql`.

## The agents ("Madame")

Server routes under `src/app/api/agents/*`, all built on
`src/lib/agents/run.ts`. Context = the wedding brief from The Desk + the
wedding's data, fetched with the **caller's own RLS-bound session** — a
client-facing agent physically cannot see drafts or internal notes.

Specialisations: budget expert · stationer's eye · hotel desk · timeline
composer · translation · monthly notes · form replies. Everything an agent
writes lands as a **draft awaiting Estelle's word**; no client notification
ever fires without an act of publication.

## Integrations

- **Google** (`src/lib/google/*`): OAuth2 refresh-token flow on Estelle's
  account. Calendar free/busy feeds "Propose a moment"; confirmations create
  Meet events; Drive gets one folder per client (shared / internal).
- **Resend** + **web push** (`src/lib/notify.ts`): every publication,
  approval request, message and payment reminder. Generate VAPID keys with
  `npx web-push generate-vapid-keys`.
- **Netlify Forms**: vendor outreach leaves from Estelle's inbox
  (`public/netlify-forms.html` registers the form).

## Structure

```
supabase/migrations/   schema · RLS · storage · RPC (verify_code, publish_*)
supabase/seed.sql      fictional demo wedding (dev only)
src/app/[locale]/      login + (hub)/ modules, one folder per module
src/app/api/agents/    Claude agent routes (server-only)
src/app/actions/       server actions (draft/publish flows, RLS re-checked)
src/lib/               supabase clients · session · rooms · agents · notify
messages/              en · fr · zh · ja · es — full house-voice translations
```

## Design

Tokens in `src/app/globals.css` (OKLCH): cream body, hunter green, champagne
hairlines, Cormorant Garamond + Jost. Entrance: hunter double doors part in
1.9 s (`cubic-bezier(.77,0,.18,1)`), personalised per wedding, with a
`prefers-reduced-motion` fallback. The word "luxury" appears nowhere.
