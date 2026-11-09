-- Account history: vs bots games, saved reviews, daily puzzle answers and
-- match counts that follow a signed-in player to every device.

create table public.history_games (
  user_id uuid not null references auth.users on delete cascade,
  at bigint not null,
  record jsonb not null,
  primary key (user_id, at)
);

create table public.history_reviews (
  user_id uuid not null references auth.users on delete cascade,
  id text not null,
  at bigint not null,
  review jsonb not null,
  primary key (user_id, id)
);

create table public.history_puzzles (
  user_id uuid not null references auth.users on delete cascade,
  day text not null,
  result jsonb not null,
  primary key (user_id, day)
);

-- One row per upload of match counts; the upload id stops a retry counting twice.
create table public.history_matches (
  user_id uuid not null references auth.users on delete cascade,
  upload_id text not null,
  matches int not null check (matches >= 0),
  match_wins int not null check (match_wins >= 0 and match_wins <= matches),
  primary key (user_id, upload_id)
);

alter table public.history_games enable row level security;
alter table public.history_reviews enable row level security;
alter table public.history_puzzles enable row level security;
alter table public.history_matches enable row level security;

-- Only /api/history touches these tables, with the secret key. Players never
-- read or write them directly, so they get no policies. Supabase's default
-- privileges still grant anon and authenticated access to new tables in
-- public; 20261109100000_revoke_history_grants.sql takes those away.
grant select, insert, update, delete on
  public.history_games, public.history_reviews, public.history_puzzles, public.history_matches
  to service_role;
