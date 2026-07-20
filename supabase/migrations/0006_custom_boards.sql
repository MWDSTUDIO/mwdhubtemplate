-- Supplementary boards beyond the standard moments: a 'custom' board
-- type, several allowed per wedding (the standard types stay unique).
alter type board_type add value if not exists 'custom';

alter table boards drop constraint if exists boards_wedding_id_type_key;
create unique index if not exists boards_one_per_standard_type
  on boards (wedding_id, type) where (type <> 'custom');
