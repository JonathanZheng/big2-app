-- An account's match counts, summed in the database. history_matches has one
-- row per upload, and reading the rows to sum them stops at the API's row
-- limit (max_rows), which undercounted after 1000 uploads.
create function public.history_match_totals(p_user uuid)
returns table (matches bigint, match_wins bigint)
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(m.matches), 0), coalesce(sum(m.match_wins), 0)
  from public.history_matches m
  where m.user_id = p_user;
$$;

-- Only /api/history calls it, with the secret key.
revoke execute on function public.history_match_totals(uuid) from public, anon, authenticated;
grant execute on function public.history_match_totals(uuid) to service_role;
