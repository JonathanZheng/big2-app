-- Writes one merge into an account's history in a single transaction, one
-- merge per account at a time. /api/history decides what changed from a read
-- made before this runs, so the writes here also keep the merge rules against
-- a merge that committed in between: a stored analysis is never replaced by a
-- record without one, a better puzzle label is never replaced by a worse one,
-- and the account keeps its newest 500 games and 50 saved reviews.
create function public.merge_history(
  p_user uuid,
  p_games jsonb,
  p_reviews jsonb,
  p_deleted_reviews text[],
  p_puzzles jsonb,
  p_matches jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  labels constant text[] := array['Best', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];
begin
  perform pg_advisory_xact_lock(hashtextextended('history:' || p_user::text, 0));

  insert into public.history_games as g (user_id, at, record)
  select p_user, (r->>'at')::bigint, r from jsonb_array_elements(p_games) r
  on conflict (user_id, at) do update set record = excluded.record
    where not (g.record ? 'analysis');

  delete from public.history_games
  where user_id = p_user
    and at not in (select at from public.history_games where user_id = p_user order by at desc limit 500);

  insert into public.history_reviews (user_id, id, at, review)
  select p_user, r->>'id', (r->>'at')::bigint, r from jsonb_array_elements(p_reviews) r
  on conflict (user_id, id) do update set at = excluded.at, review = excluded.review;

  delete from public.history_reviews where user_id = p_user and id = any(p_deleted_reviews);

  delete from public.history_reviews
  where user_id = p_user
    and id not in (select id from public.history_reviews where user_id = p_user order by at desc limit 50);

  insert into public.history_puzzles as p (user_id, day, result)
  select p_user, d.key, d.value from jsonb_each(p_puzzles) d
  on conflict (user_id, day) do update set result = excluded.result
    where array_position(labels, excluded.result->>'label') < array_position(labels, p.result->>'label');

  insert into public.history_matches (user_id, upload_id, matches, match_wins)
  select p_user, m->>'id', (m->>'matches')::int, (m->>'matchWins')::int from jsonb_array_elements(p_matches) m
  on conflict (user_id, upload_id) do nothing;
end;
$$;

-- Only /api/history calls it, with the secret key.
revoke execute on function public.merge_history(uuid, jsonb, jsonb, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.merge_history(uuid, jsonb, jsonb, text[], jsonb, jsonb) to service_role;
