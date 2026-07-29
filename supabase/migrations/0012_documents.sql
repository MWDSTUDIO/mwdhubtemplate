-- ═══════════════════════════════════════════════════════════════════
-- 0012 — The Documents room grows up (brief §6)
-- Categories, sizes, and the couple's own transmissions.
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

alter table documents add column if not exists category   text;
alter table documents add column if not exists size_bytes bigint;
alter table documents add column if not exists mime       text;
-- 'house' = placed by the house · 'client' = transmitted by the couple
alter table documents add column if not exists source     text not null default 'house';

-- Existing vendor papers read by Madame fall under their type when
-- they are later published to the couple; the register's older rows
-- read as Practical until told otherwise.
update documents set category = 'practical' where category is null;
