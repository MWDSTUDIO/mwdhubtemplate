# The Inner House — working notes for agents

- This is a **template**: never hard-code a couple, a date, a destination or
  a budget in the application. All client content lives in Supabase;
  "Camille & Alexander" exists only in `supabase/seed.sql`.
- Read `PRODUCT.md` before touching UI. Non-negotiables: OKLCH colors,
  contrast ≥ 4.5:1, no gradient text, no glassmorphism, ease-out motion,
  `prefers-reduced-motion` everywhere. The word **"luxury" is forbidden**;
  MWD is "a Parisian house of wedding planning and production".
- Client wording: tasks are **attentions** (Awaiting your word / At your
  leisure / Attended to). Never "task", "to do", "pending" client-side.
- Security lives in Postgres: RLS policies in `supabase/migrations/0002`,
  barrier tests in `supabase/tests/access_barriers.sql`. Internal material
  goes in separate tables, not hidden columns. Draft/publish is a `status`
  column, never CSS.
- Every UI string goes through `messages/*.json` — all five locales, written
  in the house's voice (keigo in JA). Keep key parity across files.
- Agents: add routes under `src/app/api/agents/`, always via
  `runAgent()` (`src/lib/agents/run.ts`) so context stays RLS-bound, and
  gate team-only routes with `gate(true)`.
- `npm run build` must stay green before any push.
