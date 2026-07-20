-- The editorial board sheet (validated template): centred header with a
-- three-word title and the house's concept paragraph, small round
-- palette dots, a staggered 7-photo collage, material chips, and the
-- house's mark. One mould for every board of every wedding.
alter table boards
  add column if not exists eyebrow text,           -- "Floral design — Wedding cocktail"
  add column if not exists concept_title text,     -- "Gathered, Luminous, Unhurried"
  add column if not exists concept_text text,      -- the concept paragraph, house voice
  add column if not exists materials text[] not null default '{}',
  add column if not exists photos jsonb not null default '{}'::jsonb,  -- {"0": "path", … "6": "path"}
  add column if not exists backdrop_path text,     -- faint background photo
  add column if not exists footer_ref text;        -- fallback: couple · destination · date
