-- A game is two tables: room_games (whose turn, what is on the table) and
-- room_hands (each seat's cards). They used to be saved one after the other,
-- so a request arriving in between read a game from one move with hands from
-- another. This saves both in one transaction. With p_expected null it
-- writes a fresh deal; otherwise it saves only if nobody saved since that
-- version was loaded, and returns false when someone did.
create function public.save_room_game(p_room uuid, p_expected int, p_game jsonb, p_hands jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare
  g public.room_games := jsonb_populate_record(null::public.room_games, p_game);
begin
  if p_expected is null then
    insert into public.room_games
      (room_id, version, current, first_move, last_play, passes, history, counts, winner, turn_deadline, updated_at)
    values (p_room, 0, g.current, g.first_move, g.last_play, g.passes, g.history, g.counts, g.winner, g.turn_deadline, now())
    on conflict (room_id) do update set
      version = 0, current = excluded.current, first_move = excluded.first_move, last_play = excluded.last_play,
      passes = excluded.passes, history = excluded.history, counts = excluded.counts, winner = excluded.winner,
      turn_deadline = excluded.turn_deadline, updated_at = excluded.updated_at;
  else
    update public.room_games set
      version = p_expected + 1, current = g.current, first_move = g.first_move, last_play = g.last_play,
      passes = g.passes, history = g.history, counts = g.counts, winner = g.winner,
      turn_deadline = g.turn_deadline, updated_at = now()
    where room_id = p_room and version = p_expected;
    if not found then
      return false;
    end if;
  end if;
  insert into public.room_hands (room_id, seat, user_id, cards)
  select p_room, h.seat, h.user_id, h.cards from jsonb_populate_recordset(null::public.room_hands, p_hands) h
  on conflict (room_id, seat) do update set user_id = excluded.user_id, cards = excluded.cards;
  return true;
end $$;

-- Only the server, with the secret key, saves games.
revoke execute on function public.save_room_game(uuid, int, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_room_game(uuid, int, jsonb, jsonb) to service_role;
