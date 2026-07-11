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
revoke all on table public.turns from public, anon, authenticated;
revoke all on table public.throws from public, anon, authenticated;
revoke all on table public.game_results from public, anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.saved_players to authenticated;
grant select, insert, update, delete on table public.games to authenticated;
grant select, insert, update, delete on table public.game_players to authenticated;
grant select, insert, update, delete on table public.game_rounds to authenticated;
grant select, insert, update, delete on table public.turns to authenticated;
grant select, insert, update, delete on table public.throws to authenticated;
grant select, insert, update, delete on table public.game_results to authenticated;

-- RLS is mandatory because these tables are exposed through Supabase's Data API.
alter table public.profiles enable row level security;
alter table public.saved_players enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_rounds enable row level security;
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

create policy "Users manage their own games"
  on public.games
  for all
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy "Users manage players in their own games"
  on public.game_players
  for all
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy "Users manage rounds in their own games"
  on public.game_rounds
  for all
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy "Users manage turns in their own games"
  on public.turns
  for all
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy "Users manage throws in their own games"
  on public.throws
  for all
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy "Users manage results in their own games"
  on public.game_results
  for all
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

commit;
