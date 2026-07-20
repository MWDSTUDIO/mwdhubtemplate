-- Supplementary boards beyond the standard moments: a 'custom' board
-- type, several allowed per wedding (the standard types stay unique).
-- NOTE: run in TWO steps in the SQL editor — a new enum value must be
-- committed before it can be referenced (error 55P04 otherwise).

-- step 1
alter type board_type add value if not exists 'custom';

-- step 2 (run separately, after step 1 is committed)
-- alter table boards drop constraint if exists boards_wedding_id_type_key;
-- create unique index if not exists boards_one_per_standard_type
--   on boards (wedding_id, type) where (type <> 'custom');
