-- Allow an authenticated user to permanently delete one of their own games.
-- Child game data is removed by the existing foreign-key cascades; profiles
-- and saved players are intentionally preserved.

begin;

create or replace function public.delete_owned_game(p_game_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid := auth.uid();
begin
  if v_owner_user_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_game_id is null then
    raise exception 'A game id is required'
      using errcode = '22004';
  end if;

  delete from public.games
  where id = p_game_id
    and owner_user_id = v_owner_user_id;

  -- False means either that the game was already deleted or that it was not
  -- owned by this user. Keeping those cases indistinguishable avoids leaking
  -- whether another account owns a supplied game id and makes retries safe.
  return found;
end;
$$;

revoke all on function public.delete_owned_game(uuid)
  from public, anon, authenticated;

grant execute on function public.delete_owned_game(uuid)
  to authenticated;

commit;
