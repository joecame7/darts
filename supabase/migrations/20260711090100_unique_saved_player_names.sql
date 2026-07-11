-- Upgrade projects installed before saved-player name uniqueness was added.
-- It prevents duplicate opponent identities from splitting statistics.

begin;

create unique index if not exists saved_players_owner_normalized_name_unique
  on public.saved_players (
    owner_user_id,
    lower(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g'))
  );

commit;
