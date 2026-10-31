-- Accounts, stats and online rooms.
--
-- Clients only ever read. Every write goes through the app's API routes, which
-- check the player's token and validate moves with the TypeScript engine, then
-- write with the secret key. A player can read the public game and their own
-- hand, never another player's hand.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now()
);

create table public.player_stats (
  user_id uuid primary key references auth.users on delete cascade,
  games int not null default 0,
  wins int not null default 0,
  matches int not null default 0,
  match_wins int not null default 0
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host uuid not null references auth.users on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  games int not null default 1 check (games in (1, 3, 5, 10)),
  hints boolean not null default false,
  -- Seconds per turn, or null for no timer.
  turn_seconds int check (turn_seconds is null or turn_seconds in (30, 60, 90)),
  game_index int not null default 0,
  wins int[] not null default '{0,0,0,0}',
  created_at timestamptz not null default now()
);

create table public.room_seats (
  room_id uuid not null references public.rooms on delete cascade,
  seat int not null check (seat between 0 and 3),
  -- The person who sat here. Kept when a bot takes over, so they can come back.
  user_id uuid references auth.users on delete set null,
  display_name text,
  -- A bot plays this seat: an empty seat at the start, or one handed over by the host.
  bot boolean not null default false,
  last_seen timestamptz,
  primary key (room_id, seat)
);
create unique index room_seats_one_seat_per_user on public.room_seats (room_id, user_id) where user_id is not null;

-- The public part of the current game.
create table public.room_games (
  room_id uuid primary key references public.rooms on delete cascade,
  version int not null default 0,
  current int not null,
  first_move boolean not null,
  last_play jsonb,
  passes int not null default 0,
  history jsonb not null default '[]',
  counts int[] not null,
  winner int,
  turn_deadline timestamptz,
  updated_at timestamptz not null default now()
);

-- Each seat's cards. Only the seat's own player can read them.
create table public.room_hands (
  room_id uuid not null references public.rooms on delete cascade,
  seat int not null check (seat between 0 and 3),
  user_id uuid references auth.users on delete set null,
  cards int[] not null,
  primary key (room_id, seat)
);

-- Membership check used by the read policies. Security definer so it can read
-- room_seats without recursing into room_seats' own policy.
create function public.is_room_member(room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_seats s where s.room_id = room and s.user_id = (select auth.uid())
  );
$$;

alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;
alter table public.rooms enable row level security;
alter table public.room_seats enable row level security;
alter table public.room_games enable row level security;
alter table public.room_hands enable row level security;

create policy "Signed-in players can read display names" on public.profiles
  for select to authenticated using (true);
create policy "Players read their own stats" on public.player_stats
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Members read their rooms" on public.rooms
  for select to authenticated using (public.is_room_member(id));
create policy "Members read the seats in their rooms" on public.room_seats
  for select to authenticated using (public.is_room_member(room_id));
create policy "Members read the game in their rooms" on public.room_games
  for select to authenticated using (public.is_room_member(room_id));
create policy "Players read only their own hand" on public.room_hands
  for select to authenticated using (user_id = (select auth.uid()));

-- New tables get no access by default. The server (secret key) can do
-- everything; signed-in players can only read, and the policies above decide
-- which rows. Signed-out visitors get nothing.
grant select, insert, update, delete on
  public.profiles, public.player_stats, public.rooms, public.room_seats, public.room_games, public.room_hands
  to service_role;
grant select on
  public.profiles, public.player_stats, public.rooms, public.room_seats, public.room_games, public.room_hands
  to authenticated;
grant execute on function public.is_room_member(uuid) to authenticated;
revoke execute on function public.is_room_member(uuid) from anon, public;

-- Live updates for room screens.
alter publication supabase_realtime add table public.rooms, public.room_seats, public.room_games, public.room_hands;
