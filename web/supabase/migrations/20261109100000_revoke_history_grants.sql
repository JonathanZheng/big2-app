-- Supabase's default privileges grant anon and authenticated access to every
-- new table in public, so the history tables were readable and writable by
-- them, held back only by row level security with no policies. Only
-- /api/history touches these tables, with the secret key, so the grants go.
revoke all on
  public.history_games, public.history_reviews, public.history_puzzles, public.history_matches
  from anon, authenticated;
