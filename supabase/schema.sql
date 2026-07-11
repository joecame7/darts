-- Darts application schema
-- Run this entire file once in the Supabase SQL Editor on an empty project.

begin;

-- A small public-schema companion to auth.users. The app creates/updates this
-- after the user has signed in; no database trigger is required.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_display_name_length
    check (char_length(btrim(display_name)) between 1 and 50)
);

-- Reusable local opponents. A game still snapshots the display name, so later
-- renames do not rewrite history. Archiving preserves opponent-based statistics.
create table public.saved_players (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint saved_players_identity_unique unique (id, owner_user_id),
  constraint saved_players_display_name_length
    check (char_length(btrim(display_name)) between 1 and 50)
);

-- One opponent identity per owner, regardless of case or surrounding/repeated
-- whitespace. Archiving preserves this identity for later restoration.
create unique index if not exists saved_players_owner_normalized_name_unique
  on public.saved_players (
    owner_user_id,
    lower(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g'))
  );

-- One row represents a complete match/session, regardless of game mode.
create table public.games (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  game_type text not null,
  rules_version integer not null default 1,
  status text not null default 'in_progress',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint games_id_owner_unique unique (id, owner_user_id),
  constraint games_type_format
    check (game_type ~ '^[a-z0-9][a-z0-9_]{0,49}$'),
  constraint games_rules_version_valid
    check (rules_version > 0),
  constraint games_status_valid
    check (status in ('in_progress', 'completed', 'abandoned')),
  constraint games_completed_at_valid
    check (
      (status = 'completed' and completed_at is not null)
      or (status <> 'completed')
    ),
  constraint games_settings_is_object
    check (jsonb_typeof(settings) = 'object')
);

-- Players may be the game owner, a reusable saved opponent, or a one-off guest.
-- Additional registered participants can be added later with an invitation and
-- consent model; for now an account player must be the game owner.
create table public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  owner_user_id uuid not null,
  user_id uuid references auth.users(id) on delete no action,
  saved_player_id uuid,
  player_type text not null,
  display_name text not null,
  player_order smallint not null,
  created_at timestamptz not null default now(),

  constraint game_players_game_owner_fkey
    foreign key (game_id, owner_user_id)
    references public.games(id, owner_user_id)
    on delete cascade,
  constraint game_players_identity_unique
    unique (id, game_id, owner_user_id),
  constraint game_players_saved_player_fkey
    foreign key (saved_player_id, owner_user_id)
    references public.saved_players(id, owner_user_id)
    on delete no action,
  constraint game_players_order_unique
    unique (game_id, player_order),
  constraint game_players_order_valid
    check (player_order > 0),
  constraint game_players_type_valid
    check (player_type in ('account', 'saved', 'guest')),
  constraint game_players_type_links_valid
    check (
      (player_type = 'account' and user_id is not null and user_id = owner_user_id and saved_player_id is null)
      or (player_type = 'saved' and user_id is null and saved_player_id is not null)
      or (player_type = 'guest' and user_id is null and saved_player_id is null)
    ),
  constraint game_players_display_name_length
    check (char_length(btrim(display_name)) between 1 and 50)
);

-- Prevent the same registered account appearing twice in one game. Multiple
-- guest players are allowed because NULL values are intentionally not equal.
create unique index game_players_registered_user_unique
  on public.game_players (game_id, user_id)
  where user_id is not null;

create unique index game_players_saved_player_unique
  on public.game_players (game_id, saved_player_id)
  where saved_player_id is not null;

-- Generic scoring containers. Most modes use one 'leg'; 501 can use nested
-- 'set' and 'leg' rows, while another mode can use a 'round' container.
create table public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  owner_user_id uuid not null,
  parent_round_id uuid,
  round_type text not null default 'leg',
  round_number integer not null,
  status text not null default 'in_progress',
  winner_player_id uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,

  constraint game_rounds_game_owner_fkey
    foreign key (game_id, owner_user_id)
    references public.games(id, owner_user_id)
    on delete cascade,
  constraint game_rounds_identity_unique
    unique (id, game_id, owner_user_id),
  constraint game_rounds_parent_fkey
    foreign key (parent_round_id, game_id, owner_user_id)
    references public.game_rounds(id, game_id, owner_user_id)
    on delete cascade,
  constraint game_rounds_winner_fkey
    foreign key (winner_player_id, game_id, owner_user_id)
    references public.game_players(id, game_id, owner_user_id)
    on delete no action,
  constraint game_rounds_type_format
    check (round_type ~ '^[a-z0-9][a-z0-9_]{0,49}$'),
  constraint game_rounds_number_valid
    check (round_number > 0),
  constraint game_rounds_status_valid
    check (status in ('in_progress', 'completed', 'abandoned')),
  constraint game_rounds_completed_at_valid
    check (
      (status = 'completed' and completed_at is not null)
      or (status <> 'completed')
    ),
  constraint game_rounds_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint game_rounds_not_own_parent
    check (parent_round_id is null or parent_round_id <> id)
);

-- Generic replayable actions for game modes whose current UI records scoring
-- actions rather than complete physical darts. Tracked Cricket uses one
-- 'cricket_mark' event per accepted scorecard tap. Future full throw-entry modes
-- should continue to use turns and throws as their canonical raw data.
create table public.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  owner_user_id uuid not null,
  game_round_id uuid,
  game_player_id uuid,
  sequence_number integer not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  voided_at timestamptz,

  constraint game_events_game_owner_fkey
    foreign key (game_id, owner_user_id)
    references public.games(id, owner_user_id)
    on delete cascade,
  constraint game_events_round_fkey
    foreign key (game_round_id, game_id, owner_user_id)
    references public.game_rounds(id, game_id, owner_user_id)
    on delete cascade,
  constraint game_events_player_fkey
    foreign key (game_player_id, game_id, owner_user_id)
    references public.game_players(id, game_id, owner_user_id)
    on delete no action,
  constraint game_events_identity_unique
    unique (id, game_id, owner_user_id),
  constraint game_events_sequence_unique
    unique (game_id, sequence_number),
  constraint game_events_sequence_valid
    check (sequence_number > 0),
  constraint game_events_type_format
    check (event_type ~ '^[a-z0-9][a-z0-9_]{0,49}$'),
  constraint game_events_payload_is_object
    check (jsonb_typeof(payload) = 'object'),
  constraint game_events_cricket_mark_shape
    check (
      event_type <> 'cricket_mark'
      or (
        game_round_id is not null
        and game_player_id is not null
        and (payload->>'segment' in ('20', '19', '18', '17', '16', '15', 'Bull')) is true
        and (payload->>'input_mode' = 'scorecard_mark') is true
      )
    ),
  constraint game_events_voided_at_valid
    check (voided_at is null or voided_at >= recorded_at)
);

-- One visit to the board by one player. sequence_number is the chronological
-- order within the round; a turn may contain one, two, or three darts.
create table public.turns (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  owner_user_id uuid not null,
  game_round_id uuid not null,
  game_player_id uuid not null,
  sequence_number integer not null,
  score_before integer,
  score_after integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,

  constraint turns_game_owner_fkey
    foreign key (game_id, owner_user_id)
    references public.games(id, owner_user_id)
    on delete cascade,
  constraint turns_round_fkey
    foreign key (game_round_id, game_id, owner_user_id)
    references public.game_rounds(id, game_id, owner_user_id)
    on delete cascade,
  constraint turns_player_fkey
    foreign key (game_player_id, game_id, owner_user_id)
    references public.game_players(id, game_id, owner_user_id)
    on delete no action,
  constraint turns_identity_unique
    unique (id, game_player_id, game_id, owner_user_id),
  constraint turns_sequence_unique
    unique (game_round_id, sequence_number),
  constraint turns_sequence_valid
    check (sequence_number > 0),
  constraint turns_score_before_valid
    check (score_before is null or score_before >= 0),
  constraint turns_score_after_valid
    check (score_after is null or score_after >= 0),
  constraint turns_metadata_is_object
    check (jsonb_typeof(metadata) = 'object')
);

-- Raw dart data is the long-term source of truth for statistics. segment 25 is
-- Bull; a miss uses segment NULL and multiplier 0. points_scored is deliberately
-- separate from segment * multiplier because Cricket can credit zero or a
-- rule-dependent score for a dart that physically hit its target.
create table public.throws (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  owner_user_id uuid not null,
  turn_id uuid not null,
  game_player_id uuid not null,
  dart_number smallint not null,
  segment smallint,
  multiplier smallint not null,
  board_score integer generated always as (coalesce(segment, 0) * multiplier) stored,
  points_scored integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  thrown_at timestamptz not null default now(),

  constraint throws_game_owner_fkey
    foreign key (game_id, owner_user_id)
    references public.games(id, owner_user_id)
    on delete cascade,
  constraint throws_turn_player_fkey
    foreign key (turn_id, game_player_id, game_id, owner_user_id)
    references public.turns(id, game_player_id, game_id, owner_user_id)
    on delete cascade,
  constraint throws_dart_number_unique
    unique (turn_id, dart_number),
  constraint throws_dart_number_valid
    check (dart_number between 1 and 3),
  constraint throws_hit_valid
    check (
      (segment is null and multiplier = 0)
      or (segment between 1 and 20 and multiplier between 1 and 3)
      or (segment = 25 and multiplier between 1 and 2)
    ),
  constraint throws_points_valid
    check (points_scored >= 0),
  constraint throws_metadata_is_object
    check (jsonb_typeof(metadata) = 'object')
);

-- Mode-neutral summary for quick history screens. Detailed or mode-specific
-- result values belong in result_data; statistics can always be recomputed from
-- turns and throws.
create table public.game_results (
  game_id uuid not null,
  game_player_id uuid not null,
  owner_user_id uuid not null,
  finishing_position smallint,
  final_score integer,
  is_winner boolean not null default false,
  result_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint game_results_pkey primary key (game_id, game_player_id),
  constraint game_results_game_owner_fkey
    foreign key (game_id, owner_user_id)
    references public.games(id, owner_user_id)
    on delete cascade,
  constraint game_results_player_fkey
    foreign key (game_player_id, game_id, owner_user_id)
    references public.game_players(id, game_id, owner_user_id)
    on delete no action,
  constraint game_results_position_valid
    check (finishing_position is null or finishing_position > 0),
  constraint game_results_score_valid
    check (final_score is null or final_score >= 0),
  constraint game_results_data_is_object
    check (jsonb_typeof(result_data) = 'object')
);

-- Query and RLS-supporting indexes.
create index games_owner_started_idx
  on public.games (owner_user_id, started_at desc);
create unique index games_one_active_cricket_per_owner
  on public.games (owner_user_id)
  where game_type = 'cricket' and status = 'in_progress';
create index saved_players_owner_idx
  on public.saved_players (owner_user_id, display_name);
create index game_players_owner_idx
  on public.game_players (owner_user_id);
create index game_players_user_idx
  on public.game_players (user_id)
  where user_id is not null;
create index game_rounds_game_idx
  on public.game_rounds (game_id, round_number);
create index game_rounds_owner_idx
  on public.game_rounds (owner_user_id);
create index game_events_owner_idx
  on public.game_events (owner_user_id);
create index game_events_round_idx
  on public.game_events (game_round_id, game_id, owner_user_id)
  where game_round_id is not null;
create index game_events_player_idx
  on public.game_events (game_player_id, game_id, owner_user_id)
  where game_player_id is not null;
create index turns_game_player_idx
  on public.turns (game_id, game_player_id, started_at);
create index turns_owner_idx
  on public.turns (owner_user_id);
create index throws_game_player_time_idx
  on public.throws (game_id, game_player_id, thrown_at);
create index throws_owner_idx
  on public.throws (owner_user_id);
create index throws_player_target_idx
  on public.throws (game_player_id, segment, multiplier);
create index game_results_owner_idx
  on public.game_results (owner_user_id);

-- Explicit API grants. Guest mode never calls Supabase, so anon receives no
-- access to application tables. RLS then restricts authenticated access by row.
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.saved_players from public, anon, authenticated;
revoke all on table public.games from public, anon, authenticated;
revoke all on table public.game_players from public, anon, authenticated;
revoke all on table public.game_rounds from public, anon, authenticated;
revoke all on table public.game_events from public, anon, authenticated;
revoke all on table public.turns from public, anon, authenticated;
revoke all on table public.throws from public, anon, authenticated;
revoke all on table public.game_results from public, anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.saved_players to authenticated;
grant select on table public.games to authenticated;
grant select on table public.game_players to authenticated;
grant select on table public.game_rounds to authenticated;
grant select, insert, update on table public.game_events to authenticated;
grant select on table public.turns to authenticated;
grant select on table public.throws to authenticated;
grant select on table public.game_results to authenticated;

-- RLS is mandatory because these tables are exposed through Supabase's Data API.
alter table public.profiles enable row level security;
alter table public.saved_players enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_rounds enable row level security;
alter table public.game_events enable row level security;
alter table public.turns enable row level security;
alter table public.throws enable row level security;
alter table public.game_results enable row level security;

create policy "Users manage their own profile"
  on public.profiles
  for all
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users manage their saved players"
  on public.saved_players
  for all
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy "Users view their own games"
  on public.games
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "Users view players in their own games"
  on public.game_players
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "Users view rounds in their own games"
  on public.game_rounds
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "Users view events in their own games"
  on public.game_events
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "Users add events to their in-progress games"
  on public.game_events
  for insert
  to authenticated
  with check (
    (select auth.uid()) = owner_user_id
    and exists (
      select 1
      from public.games as g
      where g.id = game_events.game_id
        and g.owner_user_id = (select auth.uid())
        and g.status = 'in_progress'
    )
  );

create policy "Users update events in their in-progress games"
  on public.game_events
  for update
  to authenticated
  using (
    (select auth.uid()) = owner_user_id
    and exists (
      select 1
      from public.games as g
      where g.id = game_events.game_id
        and g.owner_user_id = (select auth.uid())
        and g.status = 'in_progress'
    )
  )
  with check (
    (select auth.uid()) = owner_user_id
    and exists (
      select 1
      from public.games as g
      where g.id = game_events.game_id
        and g.owner_user_id = (select auth.uid())
        and g.status = 'in_progress'
    )
  );

create policy "Users view turns in their own games"
  on public.turns
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "Users view throws in their own games"
  on public.throws
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "Users view results in their own games"
  on public.game_results
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

-- Serialize live event writes with game finalization and keep replay identity
-- immutable. Trigger execution does not depend on caller table privileges.
create or replace function public.guard_game_event_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid := auth.uid();
begin
  if v_owner_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if new.owner_user_id is distinct from v_owner_user_id then
    raise exception 'The scoring event does not belong to the signed-in user'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if old.owner_user_id is distinct from v_owner_user_id then
      raise exception 'The scoring event does not belong to the signed-in user'
        using errcode = '42501';
    end if;

    if new.id is distinct from old.id
      or new.game_id is distinct from old.game_id
      or new.owner_user_id is distinct from old.owner_user_id
      or new.game_round_id is distinct from old.game_round_id
      or new.game_player_id is distinct from old.game_player_id
      or new.sequence_number is distinct from old.sequence_number
      or new.event_type is distinct from old.event_type
      or new.payload is distinct from old.payload
      or new.recorded_at is distinct from old.recorded_at then
      raise exception 'Scoring event identity and payload are immutable'
        using errcode = '22000';
    end if;

    if not (
      new.voided_at is not distinct from old.voided_at
      or (old.voided_at is null and new.voided_at is not null)
    ) then
      raise exception 'A scoring event can only be voided once'
        using errcode = '22000';
    end if;
  end if;

  -- This lock is held to transaction end. It orders event writes before a
  -- lifecycle RPC's FOR UPDATE lock and rechecks status after any wait.
  perform 1
  from public.games
  where id = new.game_id
    and owner_user_id = v_owner_user_id
    and status = 'in_progress'
  for share;

  if not found then
    raise exception 'Scoring events can only change while the game is in progress'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_game_event_write()
  from public, anon, authenticated;

create trigger game_events_guard_write
  before insert or update on public.game_events
  for each row
  execute function public.guard_game_event_write();

-- Atomically create a complete Cricket v1 aggregate for the signed-in owner.
-- Display names for account and saved players are sourced from owned database
-- records so callers cannot forge those identities.
create or replace function public.start_cricket_game(
  p_opponent_type text,
  p_saved_player_id uuid default null,
  p_guest_display_name text default null,
  p_app_version text default 'tracked-cricket-1'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid := auth.uid();
  v_game_id uuid := gen_random_uuid();
  v_round_id uuid := gen_random_uuid();
  v_player_one_id uuid := gen_random_uuid();
  v_player_two_id uuid := gen_random_uuid();
  v_started_at timestamptz := now();
  v_account_display_name text;
  v_opponent_display_name text;
  v_opponent_saved_player_id uuid;
  v_app_version text;
  v_settings jsonb :=
    '{"input_mode":"scorecard_mark","win_rule":"all_targets_closed_and_strictly_ahead","targets":["20","19","18","17","16","15","Bull"]}'::jsonb;
begin
  if v_owner_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select btrim(display_name)
  into v_account_display_name
  from public.profiles
  where id = v_owner_user_id;

  if not found
    or char_length(v_account_display_name) not between 1 and 50 then
    raise exception 'A valid account profile is required';
  end if;

  if p_opponent_type is null
    or p_opponent_type not in ('saved', 'guest') then
    raise exception 'Opponent type must be saved or guest';
  end if;

  if p_opponent_type = 'saved' then
    if p_saved_player_id is null or p_guest_display_name is not null then
      raise exception 'Choose exactly one saved opponent';
    end if;

    select id, btrim(display_name)
    into v_opponent_saved_player_id, v_opponent_display_name
    from public.saved_players
    where id = p_saved_player_id
      and owner_user_id = v_owner_user_id
      and archived_at is null;

    if not found then
      raise exception 'The saved opponent is unavailable';
    end if;
  else
    if p_saved_player_id is not null or p_guest_display_name is null then
      raise exception 'Enter exactly one guest opponent';
    end if;

    v_opponent_display_name :=
      regexp_replace(btrim(p_guest_display_name), '[[:space:]]+', ' ', 'g');

    if char_length(v_opponent_display_name) not between 1 and 50 then
      raise exception 'Guest names must be between 1 and 50 characters';
    end if;
  end if;

  v_app_version := coalesce(nullif(btrim(p_app_version), ''), 'tracked-cricket-1');
  if char_length(v_app_version) > 100 then
    raise exception 'App version is too long';
  end if;

  if exists (
    select 1
    from public.games
    where owner_user_id = v_owner_user_id
      and game_type = 'cricket'
      and status = 'in_progress'
  ) then
    raise exception 'Finish or abandon the active Cricket game first';
  end if;

  begin
    insert into public.games (
      id,
      owner_user_id,
      game_type,
      rules_version,
      status,
      started_at,
      settings,
      app_version
    )
    values (
      v_game_id,
      v_owner_user_id,
      'cricket',
      1,
      'in_progress',
      v_started_at,
      v_settings,
      v_app_version
    );
  exception
    when unique_violation then
      raise exception 'Finish or abandon the active Cricket game first'
        using errcode = '23505';
  end;

  insert into public.game_players (
    id,
    game_id,
    owner_user_id,
    user_id,
    saved_player_id,
    player_type,
    display_name,
    player_order
  )
  values
  (
    v_player_one_id,
    v_game_id,
    v_owner_user_id,
    v_owner_user_id,
    null,
    'account',
    v_account_display_name,
    1
  ),
  (
    v_player_two_id,
    v_game_id,
    v_owner_user_id,
    null,
    v_opponent_saved_player_id,
    p_opponent_type,
    v_opponent_display_name,
    2
  );

  insert into public.game_rounds (
    id,
    game_id,
    owner_user_id,
    round_type,
    round_number,
    status,
    started_at,
    metadata
  )
  values (
    v_round_id,
    v_game_id,
    v_owner_user_id,
    'leg',
    1,
    'in_progress',
    v_started_at,
    jsonb_build_object('game_type', 'cricket')
  );

  return jsonb_build_object(
    'id', v_game_id,
    'status', 'in_progress',
    'started_at', v_started_at,
    'rules_version', 1,
    'settings', v_settings,
    'round', jsonb_build_object(
      'id', v_round_id,
      'status', 'in_progress',
      'round_type', 'leg',
      'round_number', 1
    ),
    'players', jsonb_build_object(
      'p1', jsonb_build_object(
        'id', v_player_one_id,
        'display_name', v_account_display_name,
        'player_order', 1,
        'player_type', 'account',
        'saved_player_id', null,
        'user_id', v_owner_user_id
      ),
      'p2', jsonb_build_object(
        'id', v_player_two_id,
        'display_name', v_opponent_display_name,
        'player_order', 2,
        'player_type', p_opponent_type,
        'saved_player_id', v_opponent_saved_player_id,
        'user_id', null
      )
    )
  );
end;
$$;

-- Hardened definition: replay the non-voided event stream inside the
-- transaction, derive the canonical result, and make identical retries safe.
create or replace function public.complete_cricket_game(
  p_game_id uuid,
  p_round_id uuid,
  p_winner_player_id uuid,
  p_player_one_id uuid,
  p_player_one_score integer,
  p_player_one_hits jsonb,
  p_player_two_id uuid,
  p_player_two_score integer,
  p_player_two_hits jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid := auth.uid();
  v_completed_at timestamptz := now();
  v_game_status text;
  v_rules_version integer;
  v_round_status text;
  v_round_type text;
  v_round_number integer;
  v_total_round_count integer;
  v_total_player_count integer;
  v_supplied_player_count integer;
  v_matching_result_count integer;
  v_total_result_count integer;
  v_event record;
  v_segment text;
  v_target_value integer;
  v_own_marks integer;
  v_opponent_marks integer;
  v_player_one_hits jsonb := '{"20":0,"19":0,"18":0,"17":0,"16":0,"15":0,"Bull":0}'::jsonb;
  v_player_two_hits jsonb := '{"20":0,"19":0,"18":0,"17":0,"16":0,"15":0,"Bull":0}'::jsonb;
  v_player_one_score integer := 0;
  v_player_two_score integer := 0;
  v_player_one_closed boolean := false;
  v_player_two_closed boolean := false;
  v_outcome text;
  v_expected_winner_id uuid;
begin
  if v_owner_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if p_player_one_id is null
    or p_player_two_id is null
    or p_player_one_id = p_player_two_id
    or p_player_one_score is null
    or p_player_two_score is null
    or p_player_one_score < 0
    or p_player_two_score < 0
    or jsonb_typeof(p_player_one_hits) is distinct from 'object'
    or jsonb_typeof(p_player_two_hits) is distinct from 'object' then
    raise exception 'Invalid Cricket result';
  end if;

  select status, rules_version
  into v_game_status, v_rules_version
  from public.games
  where id = p_game_id
    and owner_user_id = v_owner_user_id
    and game_type = 'cricket'
  for update;

  if not found then
    raise exception 'The Cricket game is unavailable';
  end if;

  if v_game_status = 'completed' then
    select count(*)
    into v_matching_result_count
    from public.game_results
    where game_id = p_game_id
      and owner_user_id = v_owner_user_id
      and (
        (
          game_player_id = p_player_one_id
          and final_score = p_player_one_score
          and is_winner = coalesce(p_winner_player_id = p_player_one_id, false)
          and result_data->'hits' = p_player_one_hits
        )
        or
        (
          game_player_id = p_player_two_id
          and final_score = p_player_two_score
          and is_winner = coalesce(p_winner_player_id = p_player_two_id, false)
          and result_data->'hits' = p_player_two_hits
        )
      );

    select count(*)
    into v_total_result_count
    from public.game_results
    where game_id = p_game_id
      and owner_user_id = v_owner_user_id;

    if v_matching_result_count = 2
      and v_total_result_count = 2
      and exists (
        select 1
        from public.game_rounds
        where id = p_round_id
          and game_id = p_game_id
          and owner_user_id = v_owner_user_id
          and status = 'completed'
          and winner_player_id is not distinct from p_winner_player_id
      ) then
      return;
    end if;

    raise exception 'The game was already completed with a different result';
  end if;

  if v_game_status <> 'in_progress' then
    raise exception 'The Cricket game is no longer in progress';
  end if;

  if v_rules_version <> 1 then
    raise exception 'Unsupported Cricket rules version';
  end if;

  select count(*)
  into v_total_round_count
  from public.game_rounds
  where game_id = p_game_id
    and owner_user_id = v_owner_user_id;

  if v_total_round_count <> 1 then
    raise exception 'Cricket rules version 1 requires exactly one round';
  end if;

  select status, round_type, round_number
  into v_round_status, v_round_type, v_round_number
  from public.game_rounds
  where id = p_round_id
    and game_id = p_game_id
    and owner_user_id = v_owner_user_id
  for update;

  if not found
    or v_round_status <> 'in_progress'
    or v_round_type <> 'leg'
    or v_round_number <> 1 then
    raise exception 'The Cricket round is unavailable or invalid';
  end if;

  select count(*)
  into v_total_player_count
  from public.game_players
  where game_id = p_game_id
    and owner_user_id = v_owner_user_id;

  select count(*)
  into v_supplied_player_count
  from public.game_players
  where game_id = p_game_id
    and owner_user_id = v_owner_user_id
    and id = any (array[p_player_one_id, p_player_two_id]);

  if v_total_player_count <> 2 or v_supplied_player_count <> 2 then
    raise exception 'Cricket completion requires exactly the two supplied players';
  end if;

  if exists (
    select 1
    from public.game_events
    where game_id = p_game_id
      and owner_user_id = v_owner_user_id
      and voided_at is null
      and (
        event_type <> 'cricket_mark'
        or game_round_id is distinct from p_round_id
        or game_player_id is null
        or (payload->>'segment' in ('20', '19', '18', '17', '16', '15', 'Bull')) is not true
        or payload->>'input_mode' is distinct from 'scorecard_mark'
      )
  ) then
    raise exception 'The game contains an invalid active Cricket event';
  end if;

  for v_event in
    select game_player_id, payload->>'segment' as segment
    from public.game_events
    where game_id = p_game_id
      and owner_user_id = v_owner_user_id
      and event_type = 'cricket_mark'
      and voided_at is null
    order by sequence_number
  loop
    if v_outcome is not null then
      raise exception 'The event stream continues after the game outcome';
    end if;

    v_segment := v_event.segment;
    v_target_value := case when v_segment = 'Bull' then 25 else v_segment::integer end;

    if v_event.game_player_id = p_player_one_id then
      v_own_marks := (v_player_one_hits->>v_segment)::integer;
      v_opponent_marks := (v_player_two_hits->>v_segment)::integer;
      if v_own_marks < 3 then
        v_player_one_hits := jsonb_set(v_player_one_hits, array[v_segment], to_jsonb(v_own_marks + 1), true);
      elsif v_opponent_marks < 3 then
        v_player_one_score := v_player_one_score + v_target_value;
      else
        raise exception 'The event stream contains a mark on a closed target';
      end if;
    elsif v_event.game_player_id = p_player_two_id then
      v_own_marks := (v_player_two_hits->>v_segment)::integer;
      v_opponent_marks := (v_player_one_hits->>v_segment)::integer;
      if v_own_marks < 3 then
        v_player_two_hits := jsonb_set(v_player_two_hits, array[v_segment], to_jsonb(v_own_marks + 1), true);
      elsif v_opponent_marks < 3 then
        v_player_two_score := v_player_two_score + v_target_value;
      else
        raise exception 'The event stream contains a mark on a closed target';
      end if;
    else
      raise exception 'The event stream references a player outside this game';
    end if;

    v_player_one_closed :=
      (v_player_one_hits->>'20')::integer >= 3
      and (v_player_one_hits->>'19')::integer >= 3
      and (v_player_one_hits->>'18')::integer >= 3
      and (v_player_one_hits->>'17')::integer >= 3
      and (v_player_one_hits->>'16')::integer >= 3
      and (v_player_one_hits->>'15')::integer >= 3
      and (v_player_one_hits->>'Bull')::integer >= 3;

    v_player_two_closed :=
      (v_player_two_hits->>'20')::integer >= 3
      and (v_player_two_hits->>'19')::integer >= 3
      and (v_player_two_hits->>'18')::integer >= 3
      and (v_player_two_hits->>'17')::integer >= 3
      and (v_player_two_hits->>'16')::integer >= 3
      and (v_player_two_hits->>'15')::integer >= 3
      and (v_player_two_hits->>'Bull')::integer >= 3;

    if v_player_one_closed and v_player_one_score > v_player_two_score then
      v_outcome := 'win';
      v_expected_winner_id := p_player_one_id;
    elsif v_player_two_closed and v_player_two_score > v_player_one_score then
      v_outcome := 'win';
      v_expected_winner_id := p_player_two_id;
    elsif v_player_one_closed and v_player_two_closed and v_player_one_score = v_player_two_score then
      v_outcome := 'draw';
      v_expected_winner_id := null;
    end if;
  end loop;

  if v_outcome is null then
    raise exception 'The replayed game has no valid outcome';
  end if;

  if v_expected_winner_id is distinct from p_winner_player_id then
    raise exception 'The supplied winner does not match the event stream';
  end if;

  if v_player_one_score <> p_player_one_score
    or v_player_two_score <> p_player_two_score
    or v_player_one_hits <> p_player_one_hits
    or v_player_two_hits <> p_player_two_hits then
    raise exception 'The supplied scorecard does not match the event stream';
  end if;

  delete from public.game_results
  where game_id = p_game_id
    and owner_user_id = v_owner_user_id
    and game_player_id <> all (array[p_player_one_id, p_player_two_id]);

  insert into public.game_results (
    game_id,
    game_player_id,
    owner_user_id,
    finishing_position,
    final_score,
    is_winner,
    result_data
  )
  values
  (
    p_game_id,
    p_player_one_id,
    v_owner_user_id,
    case when v_outcome = 'draw' then null when v_expected_winner_id = p_player_one_id then 1 else 2 end,
    v_player_one_score,
    coalesce(v_expected_winner_id = p_player_one_id, false),
    jsonb_build_object(
      'outcome', case when v_outcome = 'draw' then 'draw' when v_expected_winner_id = p_player_one_id then 'win' else 'loss' end,
      'hits', v_player_one_hits,
      'input_mode', 'scorecard_mark',
      'rules_version', 1
    )
  ),
  (
    p_game_id,
    p_player_two_id,
    v_owner_user_id,
    case when v_outcome = 'draw' then null when v_expected_winner_id = p_player_two_id then 1 else 2 end,
    v_player_two_score,
    coalesce(v_expected_winner_id = p_player_two_id, false),
    jsonb_build_object(
      'outcome', case when v_outcome = 'draw' then 'draw' when v_expected_winner_id = p_player_two_id then 'win' else 'loss' end,
      'hits', v_player_two_hits,
      'input_mode', 'scorecard_mark',
      'rules_version', 1
    )
  )
  on conflict (game_id, game_player_id)
  do update set
    finishing_position = excluded.finishing_position,
    final_score = excluded.final_score,
    is_winner = excluded.is_winner,
    result_data = excluded.result_data;

  update public.game_rounds
  set status = 'completed',
      winner_player_id = v_expected_winner_id,
      completed_at = v_completed_at,
      metadata = metadata || jsonb_build_object('result', v_outcome, 'input_mode', 'scorecard_mark')
  where id = p_round_id
    and game_id = p_game_id
    and owner_user_id = v_owner_user_id
    and status = 'in_progress';

  if not found then
    raise exception 'The Cricket round changed before completion';
  end if;

  update public.games
  set status = 'completed',
      completed_at = v_completed_at,
      updated_at = v_completed_at
  where id = p_game_id
    and owner_user_id = v_owner_user_id
    and status = 'in_progress';

  if not found then
    raise exception 'The Cricket game changed before completion';
  end if;
end;
$$;

create or replace function public.abandon_cricket_game(
  p_game_id uuid,
  p_round_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid := auth.uid();
  v_game_status text;
begin
  if v_owner_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select status
  into v_game_status
  from public.games
  where id = p_game_id
    and owner_user_id = v_owner_user_id
    and game_type = 'cricket'
  for update;

  if not found then
    raise exception 'The Cricket game is unavailable';
  end if;

  if v_game_status not in ('in_progress', 'abandoned') then
    raise exception 'The Cricket game cannot be abandoned';
  end if;

  if p_round_id is not null
    and not exists (
      select 1
      from public.game_rounds
      where id = p_round_id
        and game_id = p_game_id
        and owner_user_id = v_owner_user_id
    ) then
    raise exception 'The supplied Cricket round is unavailable';
  end if;

  -- Rules versions may use zero, one, or several rounds. Abandon every active
  -- child so the aggregate cannot retain an in-progress round after finalizing.
  update public.game_rounds
  set status = 'abandoned',
      winner_player_id = null,
      completed_at = null,
      metadata = metadata || jsonb_build_object('result', 'abandoned')
  where game_id = p_game_id
    and owner_user_id = v_owner_user_id
    and status = 'in_progress';

  if v_game_status = 'abandoned' then
    return;
  end if;

  update public.games
  set status = 'abandoned',
      completed_at = null,
      updated_at = now()
  where id = p_game_id
    and owner_user_id = v_owner_user_id
    and status = 'in_progress';

  if not found then
    raise exception 'The Cricket game changed before abandonment';
  end if;
end;
$$;

-- Delete one game owned by the signed-in user. Existing foreign-key cascades
-- remove the game's players, rounds, events, turns, throws, and results while
-- leaving the account profile and saved opponents intact.
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

  return found;
end;
$$;

revoke all on function public.start_cricket_game(text, uuid, text, text)
  from public, anon;
grant execute on function public.start_cricket_game(text, uuid, text, text)
  to authenticated;

revoke all on function public.complete_cricket_game(
  uuid, uuid, uuid, uuid, integer, jsonb, uuid, integer, jsonb
) from public, anon;
grant execute on function public.complete_cricket_game(
  uuid, uuid, uuid, uuid, integer, jsonb, uuid, integer, jsonb
) to authenticated;

revoke all on function public.abandon_cricket_game(uuid, uuid) from public, anon;
grant execute on function public.abandon_cricket_game(uuid, uuid) to authenticated;

revoke all on function public.delete_owned_game(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_owned_game(uuid) to authenticated;

commit;
