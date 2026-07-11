-- Upgrade projects installed before account-player identity locking was added.
-- It prevents a game owner from attaching another account to a player.

begin;

alter table public.game_players
  drop constraint game_players_user_id_fkey;

alter table public.game_players
  drop constraint game_players_type_links_valid;

alter table public.game_players
  add constraint game_players_user_id_fkey
  foreign key (user_id)
  references auth.users(id)
  on delete no action;

alter table public.game_players
  add constraint game_players_type_links_valid
  check (
    (player_type = 'account' and user_id is not null and user_id = owner_user_id and saved_player_id is null)
    or (player_type = 'saved' and user_id is null and saved_player_id is not null)
    or (player_type = 'guest' and user_id is null and saved_player_id is null)
  );

commit;
