-- The kinship link a board displays ("Part of…, see also…") is chosen
-- by the house, not guessed: each board may point to a chosen sibling.
alter table boards
  add column if not exists related_board_id uuid references boards on delete set null;
